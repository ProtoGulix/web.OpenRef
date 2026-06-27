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
# Repères de schéma : chiffres isolés 1–999
_REPERE_RE = re.compile(r"^\d{1,3}$")
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


def _ocr_reperes_schema(img_path: str, schema_bbox: dict) -> list[dict]:
    """
    Détecte les repères numériques (1, 2, 3...) dans la zone schéma.
    Pipeline : crop → x4 LANCZOS → denoising → OTSU → dilatation → PSM 11 whitelist chiffres.
    """
    import cv2
    pil = Image.open(img_path).convert("RGB")
    x1, y1, x2, y2 = schema_bbox["x1"], schema_bbox["y1"], schema_bbox["x2"], schema_bbox["y2"]
    crop = pil.crop((x1, y1, x2, y2))
    # Agrandissement x4 pour que les petits chiffres soient lisibles
    crop = crop.resize((crop.width * 4, crop.height * 4), Image.LANCZOS)
    gray = cv2.cvtColor(np.array(crop), cv2.COLOR_RGB2GRAY)

    # Denoising léger pour supprimer le bruit de tramage des scans
    gray = cv2.fastNlMeansDenoising(gray, h=10)

    # OTSU : calcule automatiquement le meilleur seuil (adaptatif au contenu)
    _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    # Si le fond est majoritairement noir (schéma inversé), on inverse
    if np.mean(thresh) < 127:
        thresh = cv2.bitwise_not(thresh)

    # Dilatation légère : épaissit les traits fins des chiffres pour l'OCR
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
    thresh = cv2.dilate(thresh, kernel, iterations=1)

    thresh_img = Image.fromarray(thresh)
    scale = 4  # facteur d'agrandissement appliqué

    seen: dict[str, dict] = {}  # part_number -> ref avec coords

    # Passe 1 — PSM 11 whitelist chiffres : repères isolés avec coordonnées précises
    tsv = pytesseract.image_to_data(
        thresh_img,
        config="--psm 11 -c tessedit_char_whitelist=0123456789",
        output_type=pytesseract.Output.DICT,
    )
    for i in range(len(tsv["text"])):
        token = tsv["text"][i].strip()
        if not token or not _REPERE_RE.match(token):
            continue
        conf = int(tsv["conf"][i])
        if conf < 20:
            continue
        if token not in seen:
            # Ramener les coords à l'espace image original (avant x4)
            px = int(tsv["left"][i] + tsv["width"][i] / 2) // scale + x1
            py = int(tsv["top"][i] + tsv["height"][i] / 2) // scale + y1
            seen[token] = {"part_number": token, "pos_x": px, "pos_y": py, "qty": None, "contexte_groupe": None, "raw_block": token}

    # Passe 2 — PSM 6 sans whitelist : repères collés aux traits (pas de coords fines)
    raw_psm6 = pytesseract.image_to_string(thresh_img, config="--psm 6")
    for token in re.split(r"[\s,;:]+", raw_psm6):
        token = token.strip()
        if _REPERE_RE.match(token) and token not in seen:
            seen[token] = {"part_number": token, "pos_x": None, "pos_y": None, "qty": None, "contexte_groupe": None, "raw_block": token}

    refs = sorted(seen.values(), key=lambda r: int(r["part_number"]))
    return refs


def _ocr_vues_page(img_path: str, exclusion_zones: list[dict],
                   schema_bbox: dict | None = None) -> list[dict]:
    """
    OCR refs vue sur une page.
    Si schema_bbox est défini : détection des repères numériques dans la zone schéma.
    Sinon : OCR sparse sur toute la page avec masquage des zones nomenclature.
    """
    if schema_bbox:
        return _ocr_reperes_schema(img_path, schema_bbox)
    pil = Image.open(img_path)
    masked = _mask_zones(pil, exclusion_zones) if exclusion_zones else pil
    blocs = _ocr_sparse(masked)
    return _extract_refs_from_blocs(blocs)


# ── POST /vues ────────────────────────────────────────────────────────────────

async def _stream_vues(catalogue_id: int) -> AsyncGenerator[str, None]:
    db = await _get_db()
    loop = asyncio.get_event_loop()

    try:
        # Charger le schema_bbox du gabarit catalogue si disponible
        cat_row = await db.fetchrow("SELECT column_template FROM catalogue WHERE id=$1", catalogue_id)
        schema_bbox = None
        if cat_row and cat_row["column_template"]:
            tmpl = cat_row["column_template"]
            tmpl = json.loads(tmpl) if isinstance(tmpl, str) else dict(tmpl)
            schema_bbox = tmpl.get("schema_bbox")

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
                    _executor, _ocr_vues_page, img_path, zones, schema_bbox
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
                                        contexte_groupe, raw_block, pos_x, pos_y)
                                   VALUES ($1,$2,$3,$4,$5,$6,$7)""",
                                page_row["id"],
                                ref["part_number"],
                                ref.get("qty"),
                                ref.get("contexte_groupe"),
                                ref.get("raw_block"),
                                ref.get("pos_x"),
                                ref.get("pos_y"),
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


@router.post("/vues/page")
async def ocr_vues_page(page_id: int = Form(...), column_template: str = Form(None)):
    """OCR refs vue sur une page individuelle, avec schema_bbox du gabarit si fourni."""
    db = await _get_db()
    try:
        row = await db.fetchrow("SELECT image, exclusion_zones FROM page WHERE id=$1", page_id)
        if not row:
            return {"error": "Page not found"}

        tmpl = json.loads(column_template) if column_template else None
        schema_bbox = tmpl.get("schema_bbox") if tmpl else None

        img_path = row["image"]
        zones = row["exclusion_zones"] or []
        if isinstance(zones, str):
            zones = json.loads(zones)

        loop = asyncio.get_event_loop()
        refs = await loop.run_in_executor(_executor, _ocr_vues_page, img_path, zones, schema_bbox)

        # Supprimer les anciennes refs vues de cette page et réinsérer
        await db.execute("DELETE FROM references_vues WHERE page_id=$1", page_id)
        inserted = 0
        for ref in refs:
            if not ref.get("part_number"):
                continue
            await db.execute(
                """INSERT INTO references_vues (page_id, part_number, qty, contexte_groupe, raw_block, pos_x, pos_y)
                   VALUES ($1,$2,$3,$4,$5,$6,$7)""",
                page_id, ref["part_number"], ref.get("qty"),
                ref.get("contexte_groupe"), ref.get("raw_block"),
                ref.get("pos_x"), ref.get("pos_y"),
            )
            inserted += 1

        # Jointure par ref_no (repères schéma → colonne ref_no de la nomenclature)
        await db.execute(
            """UPDATE references_vues rv
               SET nomenclature_id = n.id, join_type = 'ref_no'
               FROM nomenclature n, page p
               WHERE p.id = rv.page_id AND p.id = $1
                 AND n.source_page_id = rv.page_id
                 AND rv.part_number = n.ref_no
                 AND rv.nomenclature_id IS NULL""",
            page_id,
        )
        # Jointure par part_number (refs pièce)
        await db.execute(
            """UPDATE references_vues rv
               SET nomenclature_id = n.id, join_type = 'part_number'
               FROM nomenclature n, page p
               WHERE p.id = rv.page_id AND p.id = $1
                 AND n.catalogue_id = p.id_catalogue
                 AND rv.part_number = n.part_number
                 AND rv.nomenclature_id IS NULL""",
            page_id,
        )

        return {"inserted": inserted}
    finally:
        await db.close()


# ── POST /vues/ocr-point ─────────────────────────────────────────────────────

@router.post("/vues/ocr-point")
async def ocr_point(
    page_id: int = Form(...),
    cx: int = Form(...),
    cy: int = Form(...),
    radius: int = Form(40),
):
    """
    OCR ciblé autour d'un point (cx, cy) sur l'image de la page.
    Crop (2*radius)×(2*radius) → x4 → denoising → OTSU → whitelist chiffres.
    Retourne { detected: "12" } ou { detected: null }.
    """
    import cv2
    db = await _get_db()
    try:
        row = await db.fetchrow("SELECT image FROM page WHERE id=$1", page_id)
        if not row:
            return {"detected": None}
        img_path = row["image"]
    finally:
        await db.close()

    def _do_ocr():
        pil = Image.open(img_path).convert("RGB")
        w, h = pil.size
        x1 = max(0, cx - radius)
        y1 = max(0, cy - radius)
        x2 = min(w, cx + radius)
        y2 = min(h, cy + radius)
        crop = pil.crop((x1, y1, x2, y2))
        crop = crop.resize((crop.width * 4, crop.height * 4), Image.LANCZOS)
        gray = cv2.cvtColor(np.array(crop), cv2.COLOR_RGB2GRAY)
        gray = cv2.fastNlMeansDenoising(gray, h=10)
        _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        if np.mean(thresh) < 127:
            thresh = cv2.bitwise_not(thresh)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
        thresh = cv2.dilate(thresh, kernel, iterations=1)
        thresh_img = Image.fromarray(thresh)

        # Deux passes : whitelist chiffres PSM 8 (mot unique) puis PSM 11
        for cfg in ("--psm 8 -c tessedit_char_whitelist=0123456789",
                    "--psm 11 -c tessedit_char_whitelist=0123456789"):
            raw = pytesseract.image_to_string(thresh_img, config=cfg).strip()
            digits = re.sub(r"\D", "", raw)
            if digits and re.match(r"^\d{1,3}$", digits):
                return digits
        return None

    loop = asyncio.get_event_loop()
    detected = await loop.run_in_executor(_executor, _do_ocr)
    return {"detected": detected}


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
        # Jointure par ref_no (repères schéma sur la même page)
        r1 = await db.fetchrow(
            """WITH matched AS (
                   UPDATE references_vues rv
                   SET nomenclature_id = n.id, join_type = 'ref_no'
                   FROM nomenclature n, page p
                   WHERE p.id = rv.page_id
                     AND p.id_catalogue = $1
                     AND n.source_page_id = rv.page_id
                     AND rv.part_number = n.ref_no
                     AND rv.nomenclature_id IS NULL
                   RETURNING rv.id
               )
               SELECT COUNT(*) AS c FROM matched""",
            catalogue_id,
        )
        # Jointure par part_number
        r2 = await db.fetchrow(
            """WITH matched AS (
                   UPDATE references_vues rv
                   SET nomenclature_id = n.id, join_type = 'part_number'
                   FROM nomenclature n, page p
                   WHERE p.id = rv.page_id
                     AND p.id_catalogue = $1
                     AND n.catalogue_id = $1
                     AND rv.part_number = n.part_number
                     AND rv.nomenclature_id IS NULL
                   RETURNING rv.id
               )
               SELECT COUNT(*) AS c FROM matched""",
            catalogue_id,
        )
        matched = (r1["c"] if r1 else 0) + (r2["c"] if r2 else 0)

        total = await db.fetchval(
            """SELECT COUNT(*) FROM references_vues rv
               JOIN page p ON p.id = rv.page_id
               WHERE p.id_catalogue = $1""",
            catalogue_id,
        )

        return {"catalogue_id": catalogue_id, "matched": matched, "total": total}
    finally:
        await db.close()
