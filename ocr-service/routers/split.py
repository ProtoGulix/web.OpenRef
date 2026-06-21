"""
Service [1] Découpage + [2] Deskew
POST /ocr/split  — PDF → images JPEG 300 DPI par page, puis deskew
POST /ocr/deskew — (re)deskew un catalogue déjà splitté
"""
import asyncio
import io
import json
import math
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import AsyncGenerator

import asyncpg
import cv2
import numpy as np
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


# ── Helpers ──────────────────────────────────────────────────────────────────

def _is_pdf_native(pdf_bytes: bytes) -> bool:
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages[:3]:
            if page.extract_text():
                return True
    return False


def _detect_deskew_angle(pil_img: Image.Image) -> float:
    """Détecte l'angle de rotation via transformée de Hough sur les lignes."""
    gray = np.array(pil_img.convert("L"))
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    edges = cv2.Canny(binary, 50, 150, apertureSize=3)
    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=100,
                             minLineLength=100, maxLineGap=10)
    if lines is None:
        return 0.0

    angles = []
    for line in lines:
        x1, y1, x2, y2 = line[0]
        if x2 - x1 == 0:
            continue
        angle = math.degrees(math.atan2(y2 - y1, x2 - x1))
        # Ne garder que les lignes quasi-horizontales (±15°)
        if abs(angle) <= 15:
            angles.append(angle)

    if not angles:
        return 0.0

    median_angle = float(np.median(angles))
    # Sous 0.3° on ne corrige pas (bruit résiduel)
    return median_angle if abs(median_angle) >= 0.3 else 0.0


def _apply_deskew(pil_img: Image.Image, angle: float) -> Image.Image:
    """Applique la rotation de correction. Fond blanc."""
    if angle == 0.0:
        return pil_img
    img_cv = np.array(pil_img.convert("RGB"))
    h, w = img_cv.shape[:2]
    center = (w / 2, h / 2)
    M = cv2.getRotationMatrix2D(center, angle, 1.0)
    rotated = cv2.warpAffine(img_cv, M, (w, h),
                              flags=cv2.INTER_LINEAR,
                              borderMode=cv2.BORDER_CONSTANT,
                              borderValue=(255, 255, 255))
    return Image.fromarray(rotated)


def _split_and_deskew_one(args: tuple) -> dict:
    """Convertit une page PDF en JPEG, détecte et corrige l'angle."""
    from pdf2image import convert_from_bytes
    pdf_bytes, page_num, catalogue_id = args

    storage_dir = STORAGE_ROOT / str(catalogue_id)
    storage_dir.mkdir(parents=True, exist_ok=True)

    img_path = storage_dir / f"page_{page_num:03d}.jpg"
    thumb_path = storage_dir / f"thumb_{page_num:03d}.jpg"

    images = convert_from_bytes(pdf_bytes, dpi=300, first_page=page_num, last_page=page_num)
    pil_img = images[0]

    angle = _detect_deskew_angle(pil_img)
    if angle != 0.0:
        pil_img = _apply_deskew(pil_img, angle)

    pil_img.save(str(img_path), "JPEG", quality=90)

    thumb = pil_img.copy()
    thumb.thumbnail((300, 300))
    thumb.save(str(thumb_path), "JPEG", quality=70)

    return {
        "page": page_num,
        "image": f"/storage/pages/{catalogue_id}/page_{page_num:03d}.jpg",
        "thumb": f"/storage/pages/{catalogue_id}/thumb_{page_num:03d}.jpg",
        "deskew_angle": angle,
    }


def _deskew_one(args: tuple) -> dict:
    """Deskew d'une image déjà existante (re-traitement)."""
    img_path_str, page_id, page_num = args
    pil_img = Image.open(img_path_str)
    angle = _detect_deskew_angle(pil_img)
    if angle != 0.0:
        pil_img = _apply_deskew(pil_img, angle)
        pil_img.save(img_path_str, "JPEG", quality=90)
    return {"page_id": page_id, "page_num": page_num, "deskew_angle": angle}


# ── POST /split ───────────────────────────────────────────────────────────────

async def _stream_split(
    pdf_bytes: bytes,
    catalogue_id: int,
) -> AsyncGenerator[str, None]:
    db = await _get_db()
    loop = asyncio.get_event_loop()

    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as _pdf:
            total = len(_pdf.pages)

        await db.execute(
            "UPDATE catalogue SET total_pages=$1 WHERE id=$2",
            total, catalogue_id,
        )

        yield f"data: {json.dumps({'type': 'start', 'total': total})}\n\n"

        sem = asyncio.Semaphore(WORKERS)

        async def convert_one(page_num: int):
            async with sem:
                return await loop.run_in_executor(
                    _executor, _split_and_deskew_one, (pdf_bytes, page_num, catalogue_id)
                )

        tasks = {asyncio.ensure_future(convert_one(pn)): pn for pn in range(1, total + 1)}
        pending = set(tasks.keys())

        while pending:
            done_set, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
            for fut in done_set:
                try:
                    result = fut.result()
                    page_id = await db.fetchval(
                        """INSERT INTO page
                               (id_catalogue, numero, image, thumb,
                                deskew_angle, process_status, exclusion_zones)
                           VALUES ($1, $2, $3, $4, $5, 'deskewed', '[]'::jsonb)
                           RETURNING id""",
                        catalogue_id, result["page"],
                        result["image"], result["thumb"],
                        result["deskew_angle"],
                    )
                    yield f"data: {json.dumps({'type': 'page_created', 'page': result['page'], 'page_id': page_id, 'image': result['image'], 'thumb': result['thumb'], 'deskew_angle': result['deskew_angle']})}\n\n"
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
    return StreamingResponse(
        _stream_split(pdf_bytes, catalogue_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── POST /deskew ──────────────────────────────────────────────────────────────

async def _stream_deskew(catalogue_id: int) -> AsyncGenerator[str, None]:
    db = await _get_db()
    loop = asyncio.get_event_loop()

    try:
        pages = await db.fetch(
            "SELECT id, numero, image FROM page WHERE id_catalogue=$1 ORDER BY numero",
            catalogue_id,
        )
        total = len(pages)
        yield f"data: {json.dumps({'type': 'start', 'total': total})}\n\n"

        sem = asyncio.Semaphore(WORKERS)

        async def deskew_one(row: dict):
            async with sem:
                img_path = STORAGE_ROOT / str(catalogue_id) / Path(row["image"]).name
                return await loop.run_in_executor(
                    _executor, _deskew_one, (str(img_path), row["id"], row["numero"])
                )

        tasks = [asyncio.ensure_future(deskew_one(dict(p))) for p in pages]
        pending = set(tasks)

        while pending:
            done_set, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
            for fut in done_set:
                try:
                    result = fut.result()
                    await db.execute(
                        "UPDATE page SET deskew_angle=$1, process_status='deskewed' WHERE id=$2",
                        result["deskew_angle"], result["page_id"],
                    )
                    yield f"data: {json.dumps({'type': 'page_deskewed', 'page_id': result['page_id'], 'page_num': result['page_num'], 'angle': result['deskew_angle']})}\n\n"
                except Exception as e:
                    yield f"data: {json.dumps({'type': 'page_error', 'error': str(e)})}\n\n"

        yield f"data: {json.dumps({'type': 'done', 'total': total})}\n\n"

    finally:
        await db.close()


@router.post("/deskew")
async def deskew_catalogue(catalogue_id: int = Form(...)):
    return StreamingResponse(
        _stream_deskew(catalogue_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
