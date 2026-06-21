"""
Services [6] OCR vues éclatées + [7] Jointure nomenclature ↔ vues
POST /ocr/vues     — OCR sparse sur image masquée → table references_vues
POST /ocr/jointure — jointure part_number → nomenclature_id
"""
import asyncio
import json
import os
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import AsyncGenerator

import asyncpg
import numpy as np
import pytesseract
from fastapi import APIRouter, Form
from fastapi.responses import StreamingResponse
from PIL import Image, ImageDraw

router = APIRouter()

STORAGE_ROOT = Path(os.environ.get("STORAGE_ROOT", "../storage/pages"))
DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/openref")
WORKERS = 4

_executor = ThreadPoolExecutor(max_workers=WORKERS)

# Patterns de références pièces (ordre : le plus spécifique d'abord)
_REF_PATTERNS = [
    re.compile(r"\b[A-Z]{1,4}\d{4,8}[A-Z]?\b"),      # ERC2297, NRC2864, SH504061L
    re.compile(r"\b\d{6,9}\b"),                         # 90611014, 534897
    re.compile(r"\b[A-Z]{2,4}\s?\d{3,5}\b"),            # AAU 1053, AAU1053
]
# Quantité entre parenthèses : (2), (4)
_QTY_RE = re.compile(r"\((\d+)\)")
# Titre de groupe : GROUP A, GROUP 1M, etc.
_GROUP_RE = re.compile(r"\bGROUP\s+[A-Z0-9]+\b", re.IGNORECASE)


async def _get_db() -> asyncpg.Connection:
    return await asyncpg.connect(DATABASE_URL, ssl=False)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _mask_zones(pil_img: Image.Image, zones: list[dict]) -> Image.Image:
    """Peint des rectangles blancs sur les zones d'exclusion (copie de l'image)."""
    img = pil_img.copy().convert("RGB")
    draw = ImageDraw.Draw(img)
    for z in zones:
        draw.rectangle([z["x1"], z["y1"], z["x2"], z["y2"]], fill=(255, 255, 255))
    return img


def _ocr_sparse(masked_img: Image.Image) -> list[dict]:
    """OCR psm 11 (sparse text) sur image masquée."""
    tsv = pytesseract.image_to_data(
        masked_img,
        lang="fra+eng",
        config="--psm 11",
        output_type=pytesseract.Output.DICT,
    )
    blocs = []
    for i in range(len(tsv["text"])):
        text = tsv["text"][i].strip()
        if not text:
            continue
        conf = int(tsv["conf"][i])
        if conf < 0:
            continue
        blocs.append({
            "text": text,
            "left": int(tsv["left"][i]),
            "top": int(tsv["top"][i]),
            "width": int(tsv["width"][i]),
            "height": int(tsv["height"][i]),
            "conf": conf,
        })
    return blocs


def _extract_refs_from_blocs(blocs: list[dict]) -> list[dict]:
    """
    Extrait les références pièces des blocs OCR.
    Pour chaque ref trouvée, cherche la quantité dans le même bloc ou un bloc adjacent.
    Détecte aussi le titre de groupe si présent sur la page.
    """
    # Titre de groupe : premier match GROUP sur la page
    contexte_groupe = None
    for b in blocs:
        m = _GROUP_RE.search(b["text"])
        if m:
            contexte_groupe = m.group()
            break

    refs: list[dict] = []
    seen: set[str] = set()

    for b in blocs:
        text = b["text"]

        for pattern in _REF_PATTERNS:
            for m in pattern.finditer(text):
                raw_ref = m.group().strip()
                if raw_ref in seen:
                    continue
                seen.add(raw_ref)

                # Quantité dans le même bloc
                qty = None
                qty_m = _QTY_RE.search(text)
                if qty_m:
                    qty = qty_m.group(1)
                else:
                    # Chercher dans un bloc adjacent (même Y ± 15px)
                    for nb in blocs:
                        if nb is b:
                            continue
                        if abs(nb["top"] - b["top"]) <= 15:
                            qty_m2 = _QTY_RE.search(nb["text"])
                            if qty_m2:
                                qty = qty_m2.group(1)
                                break

                refs.append({
                    "part_number": raw_ref,
                    "qty": qty,
                    "contexte_groupe": contexte_groupe,
                    "raw_block": text,
                })

    return refs


def _ocr_vues_page(img_path: str, exclusion_zones: list[dict]) -> list[dict]:
    """OCR complet d'une page vue (sparse, image masquée)."""
    pil = Image.open(img_path)
    masked = _mask_zones(pil, exclusion_zones) if exclusion_zones else pil
    blocs = _ocr_sparse(masked)
    return _extract_refs_from_blocs(blocs)


# ── POST /vues ────────────────────────────────────────────────────────────────

async def _stream_vues(catalogue_id: int) -> AsyncGenerator[str, None]:
    db = await _get_db()
    loop = asyncio.get_event_loop()

    try:
        # Toutes les pages détectées (pas seulement nomenclature)
        pages = await db.fetch(
            """SELECT id, numero, image, exclusion_zones FROM page
               WHERE id_catalogue=$1 AND process_status IN ('detected', 'ocr_done')
                 AND (type IS NULL OR type NOT IN ('cover', 'index'))
               ORDER BY numero""",
            catalogue_id,
        )
        total = len(pages)
        yield f"data: {json.dumps({'type': 'start', 'total': total})}\n\n"

        sem = asyncio.Semaphore(WORKERS)

        async def process_one(row: dict):
            async with sem:
                img_path = str(STORAGE_ROOT / str(catalogue_id) / Path(row["image"]).name)
                zones = row["exclusion_zones"] or []
                if isinstance(zones, str):
                    zones = json.loads(zones)
                return await loop.run_in_executor(
                    _executor, _ocr_vues_page, img_path, zones
                )

        tasks = {asyncio.ensure_future(process_one(dict(p))): dict(p) for p in pages}
        pending_tasks = set(tasks.keys())

        while pending_tasks:
            done_set, pending_tasks = await asyncio.wait(
                pending_tasks, return_when=asyncio.FIRST_COMPLETED
            )
            for fut in done_set:
                page_row = tasks[fut]
                try:
                    refs = fut.result()
                    async with db.transaction():
                        inserted = 0
                        for ref in refs:
                            if not ref.get("part_number"):
                                continue
                            await db.execute(
                                """INSERT INTO references_vues
                                       (page_id, part_number, qty,
                                        contexte_groupe, raw_block)
                                   VALUES ($1,$2,$3,$4,$5)""",
                                page_row["id"],
                                ref["part_number"],
                                ref.get("qty"),
                                ref.get("contexte_groupe"),
                                ref.get("raw_block"),
                            )
                            inserted += 1
                        # Marquer ocr_done seulement si la page n'était pas déjà à ce statut
                        # (les pages nomenclature_only sont déjà à ocr_done)
                        await db.execute(
                            """UPDATE page SET process_status='ocr_done'
                               WHERE id=$1 AND process_status='detected'""",
                            page_row["id"],
                        )
                    yield f"data: {json.dumps({'type': 'page_done', 'page_id': page_row['id'], 'page_num': page_row['numero'], 'refs_count': inserted})}\n\n"
                except Exception as e:
                    yield f"data: {json.dumps({'type': 'page_error', 'page_id': page_row['id'], 'error': str(e)})}\n\n"

        yield f"data: {json.dumps({'type': 'done', 'total': total})}\n\n"

    finally:
        await db.close()


@router.post("/vues")
async def ocr_vues(catalogue_id: int = Form(...)):
    return StreamingResponse(
        _stream_vues(catalogue_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── POST /jointure ────────────────────────────────────────────────────────────

@router.post("/jointure")
async def jointure_nomenclature(catalogue_id: int = Form(...)):
    """
    Jointure post-traitement : pour chaque references_vues sans nomenclature_id,
    cherche dans nomenclature du même catalogue par part_number exact.
    Retourne le bilan JSON (pas de SSE, opération rapide en BDD).
    """
    db = await _get_db()
    try:
        result = await db.fetchrow(
            """WITH matched AS (
                   UPDATE references_vues
                   SET nomenclature_id = n.id
                   FROM nomenclature n, page p
                   WHERE p.id = references_vues.page_id
                     AND p.id_catalogue  = $1
                     AND n.catalogue_id  = $1
                     AND references_vues.part_number = n.part_number
                     AND references_vues.nomenclature_id IS NULL
                   RETURNING references_vues.id
               )
               SELECT COUNT(*) AS matched_count FROM matched""",
            catalogue_id,
        )
        matched = result["matched_count"] if result else 0

        total = await db.fetchval(
            """SELECT COUNT(*) FROM references_vues rv
               JOIN page p ON p.id = rv.page_id
               WHERE p.id_catalogue = $1""",
            catalogue_id,
        )

        return {"catalogue_id": catalogue_id, "matched": matched, "total": total}
    finally:
        await db.close()
