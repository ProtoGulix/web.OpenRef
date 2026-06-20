import asyncio
import io
import json
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import AsyncGenerator

import asyncpg
import pdfplumber
import pytesseract
from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import StreamingResponse
from PIL import Image

router = APIRouter()

STORAGE_ROOT = Path(os.environ.get("STORAGE_ROOT", "../storage/pages"))
DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/openref")
WORKERS = 4

_executor = ThreadPoolExecutor(max_workers=WORKERS)


async def _get_db() -> asyncpg.Connection:
    return await asyncpg.connect(DATABASE_URL, ssl=False)


def _is_pdf_native(pdf_bytes: bytes) -> bool:
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages[:3]:
            if page.extract_text():
                return True
    return False


def _split_one_page(args: tuple) -> dict:
    """Convertit une page PDF en image JPEG, retourne les métadonnées."""
    from pdf2image import convert_from_bytes
    pdf_bytes, page_num, catalogue_id = args

    storage_dir = STORAGE_ROOT / str(catalogue_id)
    storage_dir.mkdir(parents=True, exist_ok=True)

    img_path = storage_dir / f"page_{page_num:03d}.jpg"
    thumb_path = storage_dir / f"thumb_{page_num:03d}.jpg"

    images = convert_from_bytes(pdf_bytes, dpi=200, first_page=page_num, last_page=page_num)
    pil_img = images[0]
    pil_img.save(str(img_path), "JPEG", quality=85)

    thumb = pil_img.copy()
    thumb.thumbnail((300, 300))
    thumb.save(str(thumb_path), "JPEG", quality=70)

    return {
        "page": page_num,
        "image": f"/storage/pages/{catalogue_id}/page_{page_num:03d}.jpg",
        "thumb": f"/storage/pages/{catalogue_id}/thumb_{page_num:03d}.jpg",
    }


def _extract_blocs_pdfplumber(pdf_bytes: bytes) -> list[dict]:
    pages_data = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for i, page in enumerate(pdf.pages):
            words = page.extract_words(keep_blank_chars=False, x_tolerance=3, y_tolerance=3)
            blocs = [
                {
                    "block_num": j,
                    "text": w["text"],
                    "left": int(w["x0"]),
                    "top": int(w["top"]),
                    "width": int(w["x1"] - w["x0"]),
                    "height": int(w["bottom"] - w["top"]),
                    "conf": 99,
                }
                for j, w in enumerate(words)
            ]
            pages_data.append({"page": i + 1, "blocs": blocs, "method": "pdfplumber"})
    return pages_data


def _preprocess(pil_img: Image.Image) -> Image.Image:
    import cv2
    import numpy as np
    img = np.array(pil_img.convert("L"))
    _, img = cv2.threshold(img, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    img = cv2.dilate(img, None, iterations=1)
    img = cv2.erode(img, None, iterations=1)
    return Image.fromarray(img)


def _ocr_page_file(img_path: str) -> list[dict]:
    """Tesseract sur un fichier image, retourne les blocs."""
    pil_img = Image.open(img_path)
    tsv = pytesseract.image_to_data(
        _preprocess(pil_img),
        lang="fra+eng",
        config="--psm 12",
        output_type=pytesseract.Output.DICT,
    )
    blocs = []
    for j in range(len(tsv["text"])):
        text = tsv["text"][j].strip()
        if not text or int(tsv["conf"][j]) < 0:
            continue
        blocs.append({
            "block_num": j,
            "text": text,
            "left": int(tsv["left"][j]),
            "top": int(tsv["top"][j]),
            "width": int(tsv["width"][j]),
            "height": int(tsv["height"][j]),
            "conf": int(tsv["conf"][j]),
        })
    return blocs


# ---------------------------------------------------------------------------
# POST /split
# Découpe le PDF en images, insère les pages en BDD (status=pending).
# SSE: { type: 'start', total } puis { type: 'page_created', page, image, thumb }
#      puis { type: 'done', total }
# ---------------------------------------------------------------------------

async def _stream_split(
    pdf_bytes: bytes,
    catalogue_id: int,
    native: bool,
) -> AsyncGenerator[str, None]:

    db = await _get_db()
    loop = asyncio.get_event_loop()

    try:
        if native:
            # PDF natif : pas d'images, on extrait directement le texte
            pages_data = await asyncio.to_thread(_extract_blocs_pdfplumber, pdf_bytes)
            total = len(pages_data)

            await db.execute(
                "UPDATE catalogue SET total_pages=$1 WHERE id=$2",
                total, catalogue_id,
            )

            yield f"data: {json.dumps({'type': 'start', 'total': total, 'method': 'pdfplumber'})}\n\n"

            for pd in pages_data:
                page_id = await db.fetchval(
                    """INSERT INTO page (id_catalogue, numero, status)
                       VALUES ($1, $2, 'pending') RETURNING id""",
                    catalogue_id, pd["page"],
                )
                yield f"data: {json.dumps({'type': 'page_created', 'page': pd['page'], 'page_id': page_id, 'blocs': pd['blocs'], 'method': 'pdfplumber'})}\n\n"

            yield f"data: {json.dumps({'type': 'done', 'total': total})}\n\n"
            return

        # PDF scanné : conversion en images page par page en parallèle
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as _pdf:
            total = len(_pdf.pages)

        await db.execute(
            "UPDATE catalogue SET total_pages=$1 WHERE id=$2",
            total, catalogue_id,
        )

        yield f"data: {json.dumps({'type': 'start', 'total': total, 'method': 'tesseract'})}\n\n"

        # Pool de conversion : WORKERS pages en parallèle, résultats dès qu'ils arrivent
        sem = asyncio.Semaphore(WORKERS)

        async def convert_one(page_num: int):
            async with sem:
                result = await loop.run_in_executor(
                    _executor, _split_one_page, (pdf_bytes, page_num, catalogue_id)
                )
                return result

        tasks = {asyncio.ensure_future(convert_one(pn)): pn for pn in range(1, total + 1)}
        pending = set(tasks.keys())

        while pending:
            done_set, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
            for fut in done_set:
                try:
                    result = fut.result()
                    page_id = await db.fetchval(
                        """INSERT INTO page (id_catalogue, numero, image, thumb, status)
                           VALUES ($1, $2, $3, $4, 'pending') RETURNING id""",
                        catalogue_id, result["page"], result["image"], result["thumb"],
                    )
                    yield f"data: {json.dumps({'type': 'page_created', 'page': result['page'], 'page_id': page_id, 'image': result['image'], 'thumb': result['thumb']})}\n\n"
                except Exception as e:
                    pn = tasks[fut]
                    yield f"data: {json.dumps({'type': 'page_error', 'page': pn, 'error': str(e)})}\n\n"

        yield f"data: {json.dumps({'type': 'done', 'total': total})}\n\n"

    finally:
        await db.close()


@router.post("/split")
async def split_pdf(
    file: UploadFile = File(...),
    catalogue_id: int = Form(...),
):
    pdf_bytes = await file.read()
    native = await asyncio.to_thread(_is_pdf_native, pdf_bytes)

    return StreamingResponse(
        _stream_split(pdf_bytes, catalogue_id, native),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# POST /ocr
# Pool de WORKERS threads qui consomment les pages 'pending' en BDD.
# Attend si rattrapé par le splitter (total_pages pas encore connu ou pages manquantes).
# SSE: { type: 'page_start', page_id, page_num }
#      { type: 'page_done', page_id, page_num, blocs_count }
#      { type: 'page_error', page_id, page_num, error }
#      { type: 'done', total }
# ---------------------------------------------------------------------------

async def _stream_ocr(catalogue_id: int) -> AsyncGenerator[str, None]:
    db = await _get_db()
    loop = asyncio.get_event_loop()

    try:
        yield f"data: {json.dumps({'type': 'ocr_start', 'catalogue_id': catalogue_id})}\n\n"

        pages_done = 0
        active: set[asyncio.Future] = set()

        async def take_next_page() -> dict | None:
            """Prend atomiquement la prochaine page pending (SKIP LOCKED)."""
            row = await db.fetchrow(
                """UPDATE page SET status='ocr_running'
                   WHERE id = (
                       SELECT id FROM page
                       WHERE id_catalogue=$1 AND status='pending'
                       ORDER BY numero
                       LIMIT 1
                       FOR UPDATE SKIP LOCKED
                   )
                   RETURNING id, numero, image""",
                catalogue_id,
            )
            return dict(row) if row else None

        async def total_expected() -> int | None:
            return await db.fetchval(
                "SELECT total_pages FROM catalogue WHERE id=$1", catalogue_id
            )

        def _img_path_from_url(url: str) -> str:
            # url = /storage/pages/{catalogue_id}/page_NNN.jpg
            parts = url.lstrip("/").split("/")  # ['storage', 'pages', 'N', 'page_NNN.jpg']
            return str(STORAGE_ROOT / parts[2] / parts[3])

        def _ocr_worker(page_id: int, page_num: int, img_path: str) -> dict:
            blocs = _ocr_page_file(img_path)
            return {"page_id": page_id, "page_num": page_num, "blocs": blocs}

        def _submit_page(page: dict) -> asyncio.Future:
            img_path = _img_path_from_url(page["image"])
            return loop.run_in_executor(
                _executor, _ocr_worker, page["id"], page["numero"], img_path
            )

        # Remplir le pool initial
        for _ in range(WORKERS):
            page = await take_next_page()
            if page and page["image"]:
                active.add(_submit_page(page))
                yield f"data: {json.dumps({'type': 'page_start', 'page_id': page['id'], 'page_num': page['numero']})}\n\n"

        # Boucle principale : dès qu'un thread finit, on traite le résultat et on prend la suivante
        while True:
            # Si le pool est vide, vérifier s'il reste des pages à traiter
            if not active:
                total = await total_expected()
                if total is not None and pages_done >= total:
                    # Tout traité
                    break

                # Le splitter n'a pas encore tout créé — attendre
                page = await take_next_page()
                if page and page["image"]:
                    active.add(_submit_page(page))
                    yield f"data: {json.dumps({'type': 'page_start', 'page_id': page['id'], 'page_num': page['numero']})}\n\n"
                else:
                    # Pas encore de page dispo, petit sleep puis on recheck
                    await asyncio.sleep(1)
                    continue

            done_set, active = await asyncio.wait(active, return_when=asyncio.FIRST_COMPLETED)

            for fut in done_set:
                try:
                    result = fut.result()
                    page_id = result["page_id"]
                    page_num = result["page_num"]
                    blocs = result["blocs"]

                    # Écrire les blocs en BDD dans une transaction
                    async with db.transaction():
                        for b in blocs:
                            await db.execute(
                                """INSERT INTO bloc (id_page, block_num, pos_left, pos_top, width, height, conf, text)
                                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8)""",
                                page_id, b["block_num"], b["left"], b["top"],
                                b["width"], b["height"], b["conf"], b["text"],
                            )
                        await db.execute(
                            "UPDATE page SET status='done' WHERE id=$1", page_id
                        )

                    pages_done += 1
                    yield f"data: {json.dumps({'type': 'page_done', 'page_id': page_id, 'page_num': page_num, 'blocs_count': len(blocs)})}\n\n"

                except Exception as e:
                    # Extraire page_id depuis l'exception si possible
                    yield f"data: {json.dumps({'type': 'page_error', 'error': str(e)})}\n\n"

                # Prendre la page suivante dès qu'un slot se libère
                page = await take_next_page()
                if page and page["image"]:
                    active.add(_submit_page(page))
                    yield f"data: {json.dumps({'type': 'page_start', 'page_id': page['id'], 'page_num': page['numero']})}\n\n"

        total = await total_expected()
        yield f"data: {json.dumps({'type': 'done', 'total': total, 'pages_done': pages_done})}\n\n"

    finally:
        await db.close()


@router.post("/ocr")
async def ocr_catalogue(catalogue_id: int = Form(...)):
    return StreamingResponse(
        _stream_ocr(catalogue_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# POST /image  (inchangé)
# ---------------------------------------------------------------------------

@router.post("/image")
async def ocr_image(file: UploadFile = File(...)):
    img_bytes = await file.read()
    pil_img = Image.open(io.BytesIO(img_bytes))

    tsv = pytesseract.image_to_data(
        pil_img,
        lang="fra+eng",
        output_type=pytesseract.Output.DICT,
    )

    blocs = []
    for j in range(len(tsv["text"])):
        text = tsv["text"][j].strip()
        if not text or int(tsv["conf"][j]) < 0:
            continue
        blocs.append({
            "block_num": j,
            "text": text,
            "left": int(tsv["left"][j]),
            "top": int(tsv["top"][j]),
            "width": int(tsv["width"][j]),
            "height": int(tsv["height"][j]),
            "conf": int(tsv["conf"][j]),
        })

    return {"blocs": blocs, "method": "tesseract"}
