"""
Services [4] OCR nomenclature + [5] Stockage nomenclature
POST /ocr/nomenclature — OCR ciblé sur nomenclature_bbox → table nomenclature

Algorithme :
  - OCR psm 6 sur le crop nomenclature_bbox
  - Détection des colonnes par position X des mots-clés du header
  - Regroupement des blocs par ligne Y
  - Assignation de chaque bloc à sa colonne par proximité X
  - Normalisation part_number
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
from PIL import Image

router = APIRouter()

STORAGE_ROOT = Path(os.environ.get("STORAGE_ROOT", "../storage/pages"))
DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/openref")
WORKERS = 4

_executor = ThreadPoolExecutor(max_workers=WORKERS)

# Mots-clés de colonnes et leur rôle sémantique (anglais + français)
_COL_KEYWORDS = {
    "part_number": re.compile(
        r"PART[\s._-]?N[O°.]?|PART[\s._-]?NUMBER|^NO\.?$"
        r"|NUM[ÉE]RO[\s._-]?(?:DE[\s._-]?PI[ÈE]CES?)?|^N°$|PIECES?",
        re.IGNORECASE,
    ),
    "description": re.compile(r"DESCRIPTION|D[ÉE]SIGNATION", re.IGNORECASE),
    "ref_no":      re.compile(r"^(?:ILL\.?|PLATE)$|REF[\s._-]?N?O?\.?", re.IGNORECASE),
    "qty":         re.compile(
        r"QTY\.?|QUANTITY|^Qty\.?$|NBRE|NOMBRE|QUANTIT[ÉE]|^NB\.?$",
        re.IGNORECASE,
    ),
    "remarks":     re.compile(r"REMARKS?|REMARQUES?|OBS\.?", re.IGNORECASE),
}

# Pattern référence pièce valide (inclut 4 chiffres pour M7)
_PARTNUM_RE = re.compile(
    r"^([A-Z]{1,4}\d{3,8}[A-Z]?|\d{4,9}|[A-Z]{2,4}\s?\d{3,6})$",
    re.IGNORECASE,
)
_PARTNUM_COMPACT_RE = re.compile(r"([A-Z]{1,4})\s+(\d{3,8}[A-Z]?)")

# Mots à ignorer (header, bruit OCR)
_HEADER_WORDS = re.compile(
    r"^(PART|PARTS?|DESC|DESCRIPTION|D[ÉE]SIGNATION|QTY|QUANTITY|NBRE|NOMBRE"
    r"|ILL|PLATE|REF|REMARKS?|REMARQUES?|NO\.?|N°|NUMBER|NUM[ÉE]RO|PI[ÈE]CES?)$",
    re.IGNORECASE,
)


def _normalize_part_number(raw: str) -> str:
    s = " ".join(raw.split())
    return _PARTNUM_COMPACT_RE.sub(r"\1\2", s).strip()


async def _get_db() -> asyncpg.Connection:
    return await asyncpg.connect(DATABASE_URL, ssl=False)


# ── Détection des colonnes ────────────────────────────────────────────────────

def _find_header_blocs(blocs: list[dict]) -> list[dict] | None:
    """Retourne les blocs de la ligne header (celle avec le plus de mots-clés)."""
    sorted_b = sorted(blocs, key=lambda b: b["top"])
    lines: list[list[dict]] = []
    cur = [sorted_b[0]]
    for b in sorted_b[1:]:
        if b["top"] - cur[0]["top"] <= 15:
            cur.append(b)
        else:
            lines.append(cur)
            cur = [b]
    lines.append(cur)

    best_line, best_score = None, 0
    for line in lines:
        score = sum(
            1 for b in line
            if any(p.search(b["text"]) for p in _COL_KEYWORDS.values())
        )
        if score > best_score:
            best_score, best_line = score, line

    return best_line if best_score >= 2 else None


def _classify_header_blocs(header_blocs: list[dict]) -> dict[str, int] | None:
    """
    Classifie chaque bloc header par regex et retourne {field_name: right_edge}.
    Le bord droit du mot header est la frontière de la colonne : les données
    de la colonne suivante commencent juste après.
    """
    cols: dict[str, int] = {}

    # Fusionner les blocs adjacents "Part" + "No." en un seul token
    sorted_blocs = sorted(header_blocs, key=lambda b: b["left"])
    merged: list[dict] = []
    skip_next = False
    for i, b in enumerate(sorted_blocs):
        if skip_next:
            skip_next = False
            continue
        if i + 1 < len(sorted_blocs):
            nxt = sorted_blocs[i + 1]
            gap = nxt["left"] - (b["left"] + b["width"])
            combined = b["text"] + " " + nxt["text"]
            if gap < 120 and _COL_KEYWORDS["part_number"].search(combined):
                merged.append({
                    "text": combined,
                    "left": b["left"],
                    "width": nxt["left"] + nxt["width"] - b["left"],
                    "top": b["top"], "height": b["height"], "conf": b["conf"],
                })
                skip_next = True
                continue
        merged.append(b)

    for b in merged:
        right = b["left"] + b["width"]
        for field, pattern in _COL_KEYWORDS.items():
            if pattern.search(b["text"]) and field not in cols:
                cols[field] = right
                break

    return cols if len(cols) >= 2 else None


def _detect_columns_structural(blocs: list[dict]) -> dict[str, int] | None:
    """
    Fallback quand le header est illisible : détecte les colonnes par distribution X.
    Cherche des gaps importants dans la distribution des bords gauches des blocs.
    Applicable aux catalogues M7 (NUMERO PIÈCES | NBRE | DÉSIGNATION).
    """
    # Filtrer le bruit (séparateurs, pointillés, blocs larges)
    def is_noise(b: dict) -> bool:
        t = b["text"]
        clean = re.sub(r"[|!Il\s©]", "", t)
        if not clean: return True
        if re.match(r"^[.·,\-=_©]{3,}$", t): return True
        if b["width"] > 300: return True
        if "|" in t: return True
        return False

    data_blocs = [b for b in blocs if b["text"] and not is_noise(b)]
    if len(data_blocs) < 8:
        return None

    all_lefts = [b["left"] for b in data_blocs]
    x_global_min = min(all_lefts)
    x_global_max = max(all_lefts)

    # N'analyser que le tiers gauche (où sont les colonnes numériques + qty)
    x_left_limit = x_global_min + (x_global_max - x_global_min) * 0.30
    left_blocs = [b for b in data_blocs if b["left"] <= x_left_limit]
    if len(left_blocs) < 4:
        return None

    lefts = [b["left"] for b in left_blocs]
    x_min = min(lefts)
    x_max_left = max(lefts)

    # Histogramme par bandes de 20px, limité à la zone gauche
    bin_size = 20
    from collections import Counter
    bins = Counter((b["left"] - x_min) // bin_size for b in left_blocs)
    n_bins = (x_max_left - x_min) // bin_size + 2
    hist = [bins.get(i, 0) for i in range(n_bins)]

    # Trouver les clusters (pics) séparés par des gaps ≥ 40px
    col_starts = [x_min]
    in_gap = False
    gap_start = None
    for i, count in enumerate(hist):
        if count == 0:
            if not in_gap:
                in_gap = True
                gap_start = i
        else:
            if in_gap and gap_start is not None and i - gap_start >= 2:
                col_starts.append(x_min + i * bin_size)
            in_gap = False

    if len(col_starts) < 2:
        return None

    # Contenu de chaque colonne dans la zone gauche
    def col_of(x):
        for i in range(len(col_starts) - 1, -1, -1):
            if x >= col_starts[i]: return i
        return 0

    col_texts: dict[int, list[str]] = {i: [] for i in range(len(col_starts))}
    for b in left_blocs:
        col_texts[col_of(b["left"])].append(b["text"])

    def score_pn(texts):
        return sum(1 for t in texts if re.match(r"^\d{4,6}[A-Z]?$", t)) / max(len(texts), 1)

    def score_qty(texts):
        return sum(1 for t in texts if re.match(r"^\d{1,2}$|^SE$|^ARR$|^AV$", t, re.I)) / max(len(texts), 1)

    cols: dict[str, int] = {}
    for i, start in enumerate(col_starts):
        texts = col_texts.get(i, [])
        right_edge = col_starts[i + 1] - 1 if i + 1 < len(col_starts) else start + 120
        if "part_number" not in cols and score_pn(texts) > 0.25:
            cols["part_number"] = right_edge
        elif "part_number" in cols and "qty" not in cols and score_qty(texts) > 0.2:
            cols["qty"] = right_edge

    if "part_number" not in cols:
        return None

    # La description = tout ce qui est à droite de la dernière colonne numérique
    desc_x_start = max(cols.values()) + 20
    desc_blocs = [b for b in data_blocs if b["left"] >= desc_x_start]
    if not desc_blocs:
        return None
    cols["description"] = x_global_max + 500  # right_edge très grand pour tout capturer

    return cols


def _detect_columns(blocs: list[dict]) -> dict[str, int] | None:
    """Détecte les colonnes par regex sur la ligne header, puis par analyse structurelle."""
    header = _find_header_blocs(blocs)
    if header:
        cols = _classify_header_blocs(header)
        if cols:
            return cols
    # Fallback structural pour catalogues sans header lisible (M7, etc.)
    return _detect_columns_structural(blocs)


def _assign_col(x_left: int, cols: dict[str, int]) -> str | None:
    """
    Cols = {field_name: right_edge_of_header_word}.
    Un bloc appartient à la première colonne dont le bord droit est >= son bord gauche.
    """
    if not cols:
        return None
    sorted_cols = sorted(cols.items(), key=lambda c: c[1])
    for col_name, right_edge in sorted_cols:
        if x_left <= right_edge:
            return col_name
    return sorted_cols[-1][0]


# ── Regroupement par ligne ────────────────────────────────────────────────────

def _group_lines(blocs: list[dict]) -> list[list[dict]]:
    if not blocs:
        return []
    heights = [b["height"] for b in blocs if b["height"] > 0]
    tol = float(np.median(heights)) * 0.6 if heights else 10.0

    sorted_b = sorted(blocs, key=lambda b: (b["top"], b["left"]))
    lines: list[list[dict]] = []
    cur = [sorted_b[0]]
    for b in sorted_b[1:]:
        if b["top"] - cur[0]["top"] <= tol:
            cur.append(b)
        else:
            lines.append(sorted(cur, key=lambda x: x["left"]))
            cur = [b]
    lines.append(sorted(cur, key=lambda x: x["left"]))
    return lines


# ── Parser positionnel ────────────────────────────────────────────────────────

def _parse_line_positional(line: list[dict], cols: dict[str, int]) -> dict | None:
    """
    Assigne chaque bloc de la ligne à sa colonne par position X.
    Retourne None si la ligne n'a pas de part_number valide.
    """
    buckets: dict[str, list[str]] = {c: [] for c in cols}

    for b in line:
        col = _assign_col(b["left"], cols)
        if col:
            buckets[col].append(b["text"])

    # Assembler chaque colonne
    assembled = {c: " ".join(tokens).strip() for c, tokens in buckets.items()}

    # Rejeter les lignes header
    pn_raw = assembled.get("part_number", "")
    if _HEADER_WORDS.match(pn_raw):
        return None

    pn = _normalize_part_number(pn_raw)

    # Accepter les numéros de 4+ chiffres même sans match strict (format M7)
    _PARTNUM_LOOSE_RE = re.compile(r"^\d{4,}[A-Z]?$", re.IGNORECASE)

    if not pn or not (_PARTNUM_RE.match(pn) or _PARTNUM_LOOSE_RE.match(pn)):
        # Fallback : chercher un token ressemblant à une référence dans la ligne
        for b in reversed(line):
            candidate = _normalize_part_number(b["text"])
            if _PARTNUM_RE.match(candidate):
                pn = candidate
                break

    if not pn:
        return None

    desc = assembled.get("description", "") or ""
    desc = re.sub(r"^[|:;=\-\s]+", "", desc).strip()

    # ref_no : d'abord chercher dans la colonne dédiée (ILL/PLATE)
    # Si absent, extraire le numéro de repère en tête de description ("1 CRANKSHAFT..." → "1")
    ref_raw = assembled.get("ref_no") or ""
    ref_match = re.search(r"\b(\d+[A-Z]?)\b", ref_raw)
    if ref_match:
        ref_no = ref_match.group(1)
    else:
        # Numéro de repère souvent en tête de description
        head_match = re.match(r"^\s*(\d+[A-Z]?)\s+\S", desc)
        if head_match:
            ref_no = head_match.group(1)
            desc = desc[head_match.end(1):].strip()
        else:
            ref_no = None

    return {
        "part_number": pn[:100],
        "description": desc[:500] if desc else None,
        "ref_no":      ref_no,
        "qty":         (assembled.get("qty") or "")[:20] or None,
        "remarks":     (assembled.get("remarks") or "")[:500] or None,
    }


# ── Parser fallback (sans colonnes détectées) ─────────────────────────────────

def _parse_line_fallback(line: list[dict]) -> dict | None:
    """
    Quand le header n'a pas été localisé : cherche un token référence
    et reconstruit description depuis les tokens restants.
    """
    pn = None
    pn_idx = None
    for i, b in enumerate(reversed(line)):
        candidate = _normalize_part_number(b["text"])
        if _PARTNUM_RE.match(candidate):
            pn = candidate
            pn_idx = len(line) - 1 - i
            break

    if not pn:
        return None

    desc_tokens = [b["text"] for i, b in enumerate(line) if i != pn_idx]
    desc = " ".join(desc_tokens).strip()
    desc = re.sub(r"^[|:;=\-\s]+", "", desc).strip()

    return {
        "part_number": pn[:100],
        "description": desc[:500] if desc else None,
        "ref_no": None,
        "qty": None,
        "remarks": None,
    }


# ── Pipeline complet d'une page ───────────────────────────────────────────────

def _ocr_nomenclature_page(img_path: str, bbox: dict, column_template: dict | None = None) -> list[dict]:
    pil = Image.open(img_path)
    x1, y1, x2, y2 = bbox["x1"], bbox["y1"], bbox["x2"], bbox["y2"]
    crop = pil.crop((max(0, x1 - 5), max(0, y1 - 5), x2 + 5, y2 + 5))

    tsv = pytesseract.image_to_data(
        crop,
        lang="fra+eng",
        config="--psm 6",
        output_type=pytesseract.Output.DICT,
    )

    blocs = []
    for i in range(len(tsv["text"])):
        text = tsv["text"][i].strip()
        if not text or int(tsv["conf"][i]) < 0:
            continue
        blocs.append({
            "text": text,
            "left": int(tsv["left"][i]) + x1,
            "top":  int(tsv["top"][i])  + y1,
            "width":  int(tsv["width"][i]),
            "height": int(tsv["height"][i]),
            "conf": int(tsv["conf"][i]),
        })

    # Si un gabarit de colonnes est fourni, l'utiliser directement
    if column_template:
        cols = column_template  # {field_name: x_right_abs}
    else:
        cols = _detect_columns(blocs)

    lines = _group_lines(blocs)

    rows = []
    for line in lines:
        if cols:
            parsed = _parse_line_positional(line, cols)
        else:
            parsed = _parse_line_fallback(line)
        if parsed:
            rows.append(parsed)

    return rows


# ── POST /nomenclature ────────────────────────────────────────────────────────

def _ocr_all_bboxes(img_path: str, bboxes: list[dict], column_template: dict | None) -> list[tuple[str, list[dict]]]:
    """Lance l'OCR sur chaque bbox nommée et retourne [(bbox_name, rows), ...]."""
    results = []
    for bbox in bboxes:
        name = bbox.get("name", "Nomenclature")
        rows = _ocr_nomenclature_page(img_path, bbox, column_template)
        results.append((name, rows))
    return results


async def _stream_nomenclature(catalogue_id: int, column_template: dict | None = None) -> AsyncGenerator[str, None]:
    db = await _get_db()
    loop = asyncio.get_event_loop()

    try:
        pages = await db.fetch(
            """SELECT id, numero, image, nomenclature_bbox, nomenclature_bboxes FROM page
               WHERE id_catalogue=$1 AND has_nomenclature=TRUE
                 AND process_status='detected'
               ORDER BY numero""",
            catalogue_id,
        )
        total = len(pages)
        yield f"data: {json.dumps({'type': 'start', 'total': total})}\n\n"

        sem = asyncio.Semaphore(WORKERS)

        async def process_one(row: dict):
            async with sem:
                img_path = str(STORAGE_ROOT / str(catalogue_id) / Path(row["image"]).name)
                bboxes = row["nomenclature_bboxes"]
                if isinstance(bboxes, str):
                    bboxes = json.loads(bboxes)
                # Fallback sur nomenclature_bbox si le tableau est vide
                if not bboxes:
                    bbox = row["nomenclature_bbox"]
                    if isinstance(bbox, str):
                        bbox = json.loads(bbox)
                    bboxes = [{**bbox, "name": "Nomenclature"}] if bbox else []
                return await loop.run_in_executor(
                    _executor, _ocr_all_bboxes, img_path, bboxes, column_template
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
                    bbox_results = fut.result()  # [(bbox_name, rows), ...]
                    async with db.transaction():
                        inserted = 0
                        for bbox_name, rows in bbox_results:
                            for row_data in rows:
                                await db.execute(
                                    """INSERT INTO nomenclature
                                           (catalogue_id, source_page_id, bbox_name,
                                            part_number, description, ref_no, qty, remarks)
                                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)""",
                                    catalogue_id,
                                    page_row["id"],
                                    bbox_name,
                                    row_data["part_number"],
                                    row_data.get("description"),
                                    row_data.get("ref_no"),
                                    row_data.get("qty"),
                                    row_data.get("remarks"),
                                )
                                inserted += 1
                        await db.execute(
                            "UPDATE page SET process_status='ocr_done' WHERE id=$1",
                            page_row["id"],
                        )
                    yield f"data: {json.dumps({'type': 'page_done', 'page_id': page_row['id'], 'page_num': page_row['numero'], 'inserted': inserted})}\n\n"
                except Exception as e:
                    yield f"data: {json.dumps({'type': 'page_error', 'page_id': page_row['id'], 'error': str(e)})}\n\n"

        yield f"data: {json.dumps({'type': 'done', 'total': total})}\n\n"

    finally:
        await db.close()


@router.post("/nomenclature")
async def ocr_nomenclature(catalogue_id: int = Form(...), column_template: str = Form(None)):
    tmpl = json.loads(column_template) if column_template else None
    return StreamingResponse(
        _stream_nomenclature(catalogue_id, tmpl),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/nomenclature/page")
async def ocr_nomenclature_page(page_id: int = Form(...)):
    """Relance l'OCR nomenclature sur une seule page (après correction manuelle des bboxes)."""
    db = await _get_db()
    loop = asyncio.get_event_loop()
    try:
        row = await db.fetchrow(
            "SELECT id, numero, image, nomenclature_bbox, nomenclature_bboxes, id_catalogue FROM page WHERE id=$1",
            page_id,
        )
        if not row:
            return {"error": "page not found"}

        bboxes = row["nomenclature_bboxes"]
        if isinstance(bboxes, str):
            bboxes = json.loads(bboxes)
        if not bboxes:
            bbox = row["nomenclature_bbox"]
            if isinstance(bbox, str):
                bbox = json.loads(bbox)
            bboxes = [{**bbox, "name": "Nomenclature"}] if bbox else []
        if not bboxes:
            return {"error": "no nomenclature_bboxes"}

        catalogue_id = row["id_catalogue"]
        img_path = str(STORAGE_ROOT / str(catalogue_id) / Path(row["image"]).name)

        cat_row = await db.fetchrow("SELECT column_template FROM catalogue WHERE id=$1", catalogue_id)
        column_template = None
        if cat_row and cat_row["column_template"]:
            tmpl = cat_row["column_template"]
            column_template = json.loads(tmpl) if isinstance(tmpl, str) else dict(tmpl)

        await db.execute("DELETE FROM nomenclature WHERE source_page_id=$1", page_id)

        bbox_results = await loop.run_in_executor(_executor, _ocr_all_bboxes, img_path, bboxes, column_template)

        async with db.transaction():
            inserted = 0
            for bbox_name, rows in bbox_results:
                for row_data in rows:
                    await db.execute(
                        """INSERT INTO nomenclature
                               (catalogue_id, source_page_id, bbox_name,
                                part_number, description, ref_no, qty, remarks)
                           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)""",
                        catalogue_id, page_id, bbox_name,
                        row_data["part_number"],
                        row_data.get("description"),
                        row_data.get("ref_no"),
                        row_data.get("qty"),
                        row_data.get("remarks"),
                    )
                    inserted += 1
            await db.execute("UPDATE page SET process_status='ocr_done' WHERE id=$1", page_id)

        return {"page_id": page_id, "inserted": inserted}
    finally:
        await db.close()
