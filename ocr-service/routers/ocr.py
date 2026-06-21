import asyncio
import io
import json
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import AsyncGenerator

import asyncpg
import httpx
import pdfplumber
import pytesseract
from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import StreamingResponse
from PIL import Image

router = APIRouter()

STORAGE_ROOT = Path(os.environ.get("STORAGE_ROOT", "../storage/pages"))
DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/openref")
OLLAMA_URL   = os.environ.get("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen2.5:7b")
WORKERS      = 4
PARSE_WORKERS = 2  # threads parse en parallèle de l'OCR

_executor = ThreadPoolExecutor(max_workers=WORKERS + PARSE_WORKERS)


async def _get_db() -> asyncpg.Connection:
    return await asyncpg.connect(DATABASE_URL, ssl=False)


# ---------------------------------------------------------------------------
# Helpers PDF / image
# ---------------------------------------------------------------------------

def _is_pdf_native(pdf_bytes: bytes) -> bool:
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages[:3]:
            if page.extract_text():
                return True
    return False


def _split_one_page(args: tuple) -> dict:
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


def _img_path_from_url(url: str) -> str:
    parts = url.lstrip("/").split("/")  # ['storage', 'pages', 'N', 'page_NNN.jpg']
    return str(STORAGE_ROOT / parts[2] / parts[3])


# ---------------------------------------------------------------------------
# POST /split
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

        with pdfplumber.open(io.BytesIO(pdf_bytes)) as _pdf:
            total = len(_pdf.pages)

        await db.execute(
            "UPDATE catalogue SET total_pages=$1 WHERE id=$2",
            total, catalogue_id,
        )

        yield f"data: {json.dumps({'type': 'start', 'total': total, 'method': 'tesseract'})}\n\n"

        sem = asyncio.Semaphore(WORKERS)

        async def convert_one(page_num: int):
            async with sem:
                return await loop.run_in_executor(
                    _executor, _split_one_page, (pdf_bytes, page_num, catalogue_id)
                )

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
# Pool de WORKERS threads Tesseract sur les pages 'pending'.
# ---------------------------------------------------------------------------

async def _run_ocr(catalogue_id: int, queue: asyncio.Queue) -> None:
    """Consomme les pages pending, écrit les blocs, pousse les events dans queue."""
    db = await _get_db()
    loop = asyncio.get_event_loop()
    pages_done = 0
    active: set[asyncio.Future] = set()

    async def take_pending() -> dict | None:
        row = await db.fetchrow(
            """UPDATE page SET status='ocr_running'
               WHERE id = (
                   SELECT id FROM page
                   WHERE id_catalogue=$1 AND status='pending'
                   ORDER BY numero LIMIT 1
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

    def _ocr_worker(page_id: int, page_num: int, img_path: str) -> dict:
        return {"page_id": page_id, "page_num": page_num, "blocs": _ocr_page_file(img_path)}

    def _submit(page: dict) -> asyncio.Future:
        return loop.run_in_executor(
            _executor, _ocr_worker, page["id"], page["numero"], _img_path_from_url(page["image"])
        )

    try:
        for _ in range(WORKERS):
            page = await take_pending()
            if page and page["image"]:
                active.add(_submit(page))
                await queue.put({"type": "page_start", "page_id": page["id"], "page_num": page["numero"]})

        while True:
            if not active:
                total = await total_expected()
                if total is not None and pages_done >= total:
                    break
                page = await take_pending()
                if page and page["image"]:
                    active.add(_submit(page))
                    await queue.put({"type": "page_start", "page_id": page["id"], "page_num": page["numero"]})
                else:
                    await asyncio.sleep(1)
                    continue

            done_set, active = await asyncio.wait(active, return_when=asyncio.FIRST_COMPLETED)

            for fut in done_set:
                try:
                    result = fut.result()
                    page_id, page_num, blocs = result["page_id"], result["page_num"], result["blocs"]

                    async with db.transaction():
                        for b in blocs:
                            await db.execute(
                                """INSERT INTO bloc (id_page, block_num, pos_left, pos_top, width, height, conf, text)
                                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8)""",
                                page_id, b["block_num"], b["left"], b["top"],
                                b["width"], b["height"], b["conf"], b["text"],
                            )
                        await db.execute("UPDATE page SET status='done' WHERE id=$1", page_id)

                    pages_done += 1
                    await queue.put({"type": "page_done", "page_id": page_id, "page_num": page_num, "blocs_count": len(blocs)})

                except Exception as e:
                    await queue.put({"type": "page_error", "source": "ocr", "error": str(e)})

                page = await take_pending()
                if page and page["image"]:
                    active.add(_submit(page))
                    await queue.put({"type": "page_start", "page_id": page["id"], "page_num": page["numero"]})

        total = await total_expected()
        await queue.put({"type": "ocr_done", "total": total, "pages_done": pages_done})

    finally:
        await db.close()


# ---------------------------------------------------------------------------
# Parse Ollama
# Pool de PARSE_WORKERS coroutines sur les pages 'done'.
# ---------------------------------------------------------------------------

PARSE_PROMPT = """Catalogue de pièces Land Rover Series III (années 70-80), page scannée OCR.

Les références pièces Land Rover sont : des nombres de 6 chiffres (ex: 272539, 239929, 269889, 537229) OU des codes alphanumériques (ex: RTC3184, ETC5276, SH607101L, WL110001L).

Sur cette page (schéma éclaté), chaque référence est annotée à côté du composant dessiné. Un encadré en bas de page peut décrire certaines pièces avec leur référence.

Extrais CHAQUE nombre de 6 chiffres ou code alphanumérique qui est une référence pièce.
Ignore : numéros de page (ex: "12", "1E 12"), mots en anglais, ponctuation isolée.

Retourne {"refs": [...]} où chaque élément a :
- "part_number": la référence (obligatoire)
- "plate_ref": numéro de repère si présent juste avant la référence sur le schéma (null sinon)
- "description": description si trouvée dans un encadré texte en bas de page (null sinon)
- "qty": quantité si "(2)" ou "Qty X" présent à côté (null sinon)
- "remarks": note de compatibilité si présente ex: "From engine No. 366194208" (null sinon)

Blocs OCR (left, top, confiance%, texte) :
"""


async def _parse_page_ollama(page_id: int, page_num: int, blocs: list[dict]) -> list[dict]:
    """Envoie les blocs d'une page à Ollama, retourne les références parsées."""
    blocs_text = "\n".join(
        f"  ({b['pos_left']:4d},{b['pos_top']:4d}) [{b['conf']:3d}%] {b['text']}"
        for b in sorted(blocs, key=lambda b: (b["pos_top"], b["pos_left"]))
    )

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            f"{OLLAMA_URL}/api/generate",
            json={
                "model": OLLAMA_MODEL,
                "prompt": PARSE_PROMPT + blocs_text,
                "stream": False,
                "format": "json",
            },
        )
        resp.raise_for_status()
        raw = resp.json()["response"]

    try:
        data = json.loads(raw)
        # Le LLM retourne {"refs": [...]} ou directement [...]
        if isinstance(data, dict):
            refs = data.get("refs", [])
            if not refs and len(data) == 1:
                refs = list(data.values())[0]
        elif isinstance(data, list):
            refs = data
        else:
            return []
        return [r for r in refs if isinstance(r, dict) and r.get("part_number")]
    except json.JSONDecodeError:
        import re
        m = re.search(r"\[.*\]", raw, re.DOTALL)
        if m:
            try:
                return json.loads(m.group())
            except Exception:
                pass
        return []


async def _run_parse(catalogue_id: int, queue: asyncio.Queue) -> None:
    """Consomme les pages 'done', les envoie à Ollama, insère les références."""
    db = await _get_db()
    pages_done = 0
    active: set[asyncio.Task] = set()

    async def take_done() -> dict | None:
        row = await db.fetchrow(
            """UPDATE page SET status='parse_running'
               WHERE id = (
                   SELECT id FROM page
                   WHERE id_catalogue=$1 AND status='done'
                   ORDER BY numero LIMIT 1
                   FOR UPDATE SKIP LOCKED
               )
               RETURNING id, numero""",
            catalogue_id,
        )
        return dict(row) if row else None

    async def total_expected() -> int | None:
        return await db.fetchval(
            "SELECT total_pages FROM catalogue WHERE id=$1", catalogue_id
        )

    async def parse_one(page_id: int, page_num: int) -> dict:
        blocs = await db.fetch(
            "SELECT pos_left, pos_top, text, conf FROM bloc WHERE id_page=$1", page_id
        )
        blocs_list = [dict(b) for b in blocs]
        refs = await _parse_page_ollama(page_id, page_num, blocs_list)
        return {"page_id": page_id, "page_num": page_num, "refs": refs}

    try:
        # Remplir le pool parse initial
        for _ in range(PARSE_WORKERS):
            page = await take_done()
            if page:
                t = asyncio.ensure_future(parse_one(page["id"], page["numero"]))
                active.add(t)
                await queue.put({"type": "parse_start", "page_id": page["id"], "page_num": page["numero"]})

        while True:
            if not active:
                total = await total_expected()
                # Attendre si l'OCR n'a pas encore tout terminé
                ocr_remaining = await db.fetchval(
                    """SELECT COUNT(*) FROM page
                       WHERE id_catalogue=$1 AND status IN ('pending','ocr_running','done')""",
                    catalogue_id,
                )
                if total is not None and pages_done >= total and ocr_remaining == 0:
                    break
                page = await take_done()
                if page:
                    t = asyncio.ensure_future(parse_one(page["id"], page["numero"]))
                    active.add(t)
                    await queue.put({"type": "parse_start", "page_id": page["id"], "page_num": page["numero"]})
                else:
                    await asyncio.sleep(2)
                    continue

            done_set, active = await asyncio.wait(active, return_when=asyncio.FIRST_COMPLETED)

            for fut in done_set:
                try:
                    result = fut.result()
                    page_id, page_num, refs = result["page_id"], result["page_num"], result["refs"]

                    async with db.transaction():
                        for ref in refs:
                            if not ref.get("part_number") and not ref.get("description"):
                                continue
                            await db.execute(
                                """INSERT INTO reference
                                   (id_page, plate_ref, part_number, description, qty, remarks)
                                   VALUES ($1,$2,$3,$4,$5,$6)""",
                                page_id,
                                str(ref.get("plate_ref") or "")[:20] or None,
                                str(ref.get("part_number") or "")[:100] or None,
                                ref.get("description"),
                                int(ref["qty"]) if str(ref.get("qty") or "").isdigit() else None,
                                ref.get("remarks"),
                            )
                        await db.execute("UPDATE page SET status='refs_done' WHERE id=$1", page_id)

                    pages_done += 1
                    await queue.put({"type": "parse_done", "page_id": page_id, "page_num": page_num, "refs_count": len(refs)})

                except Exception as e:
                    await queue.put({"type": "page_error", "source": "parse", "error": str(e)})

                page = await take_done()
                if page:
                    t = asyncio.ensure_future(parse_one(page["id"], page["numero"]))
                    active.add(t)
                    await queue.put({"type": "parse_start", "page_id": page["id"], "page_num": page["numero"]})

        total = await total_expected()
        await queue.put({"type": "parse_done_all", "total": total, "pages_done": pages_done})

    finally:
        await db.close()


# ---------------------------------------------------------------------------
# POST /ocr  — lance OCR + Parse en parallèle, stream SSE unifié
# SSE events: page_start, page_done, parse_start, parse_done, page_error,
#             ocr_done, parse_done_all, done
# ---------------------------------------------------------------------------

async def _stream_ocr_and_parse(catalogue_id: int) -> AsyncGenerator[str, None]:
    queue: asyncio.Queue = asyncio.Queue()

    yield f"data: {json.dumps({'type': 'ocr_start', 'catalogue_id': catalogue_id})}\n\n"

    ocr_task   = asyncio.ensure_future(_run_ocr(catalogue_id, queue))
    parse_task = asyncio.ensure_future(_run_parse(catalogue_id, queue))

    ocr_finished   = False
    parse_finished = False

    while not (ocr_finished and parse_finished):
        try:
            event = await asyncio.wait_for(queue.get(), timeout=2.0)
        except asyncio.TimeoutError:
            # Vérifier si les tâches se sont terminées avec une exception
            if ocr_task.done() and not ocr_finished:
                if ocr_task.exception():
                    yield f"data: {json.dumps({'type': 'page_error', 'source': 'ocr', 'error': str(ocr_task.exception())})}\n\n"
                ocr_finished = True
            if parse_task.done() and not parse_finished:
                if parse_task.exception():
                    yield f"data: {json.dumps({'type': 'page_error', 'source': 'parse', 'error': str(parse_task.exception())})}\n\n"
                parse_finished = True
            continue

        if event["type"] == "ocr_done":
            ocr_finished = True
        elif event["type"] == "parse_done_all":
            parse_finished = True

        yield f"data: {json.dumps(event)}\n\n"

    yield f"data: {json.dumps({'type': 'done', 'catalogue_id': catalogue_id})}\n\n"


@router.post("/ocr")
async def ocr_catalogue(catalogue_id: int = Form(...)):
    return StreamingResponse(
        _stream_ocr_and_parse(catalogue_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# POST /parse  — relancer uniquement le parse sur un catalogue déjà OCRisé
# ---------------------------------------------------------------------------

@router.post("/parse")
async def parse_catalogue(catalogue_id: int = Form(...)):
    return StreamingResponse(
        _stream_parse_only(catalogue_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _stream_parse_only(catalogue_id: int) -> AsyncGenerator[str, None]:
    queue: asyncio.Queue = asyncio.Queue()
    yield f"data: {json.dumps({'type': 'parse_start_all', 'catalogue_id': catalogue_id})}\n\n"

    parse_task = asyncio.ensure_future(_run_parse(catalogue_id, queue))

    while not parse_task.done():
        try:
            event = await asyncio.wait_for(queue.get(), timeout=2.0)
        except asyncio.TimeoutError:
            continue
        yield f"data: {json.dumps(event)}\n\n"
        if event["type"] == "parse_done_all":
            break

    if parse_task.exception():
        yield f"data: {json.dumps({'type': 'page_error', 'source': 'parse', 'error': str(parse_task.exception())})}\n\n"

    yield f"data: {json.dumps({'type': 'done', 'catalogue_id': catalogue_id})}\n\n"


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
