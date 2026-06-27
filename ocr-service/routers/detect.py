"""
Service [3] Détection de nomenclature
POST /ocr/detect — typage de page, bbox nomenclature, zones d'exclusion

Algorithme :
  3a. OCR rapide pleine page (psm 6, TSV)
  3b. Détection header tableau par mots-clés
  3c. Calcul bbox table (gap > 2.5× espacement médian = fin de table)
  3d. Typage page (view_only / nomenclature_only / mixed)
  3e. exclusion_zones initialisé depuis nomenclature_bbox
"""
import asyncio
import json
import os
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import AsyncGenerator

import asyncpg
import cv2
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

# Mots-clés de header de tableau nomenclature
_HEADER_KEYWORDS = [
    r"PART[\s._-]?N[O°.]?",
    r"PART[\s._-]?NUMBER",
    r"DESCRIPTION",
    r"REF[\s._-]?N[O°.]?",
    r"QTY",
    r"QUANTITY",
    r"ILL\.?",
    r"REMARKS",
]
_KW_RE = re.compile(
    "(" + "|".join(_HEADER_KEYWORDS) + ")",
    re.IGNORECASE,
)

# Tolérance verticale pour regrouper des blocs sur la "même ligne" (pixels)
_LINE_TOLERANCE = 8
# Seuil longueur texte court → signal vue éclatée
_SHORT_TEXT_LEN = 12

# Pattern référence numérique catalogue FR (Motobécane et similaires) : 4-6 chiffres
_REF_NUM_RE = re.compile(r"^\d{4,6}$")


async def _get_db() -> asyncpg.Connection:
    return await asyncpg.connect(DATABASE_URL, ssl=False)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _ocr_full_page(img_path: str) -> list[dict]:
    """OCR psm 6 pleine page, retourne blocs TSV avec bbox."""
    pil = Image.open(img_path)
    tsv = pytesseract.image_to_data(
        pil,
        lang="fra+eng",
        config="--psm 6",
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


def _find_header_line(blocs: list[dict], min_keywords: int = 2) -> int | None:
    """
    Retourne le bas du header (max de top+height) si ≥ min_keywords mots-clés distincts
    sur la même ligne horizontale.

    min_keywords peut être abaissé à 1 quand un gabarit est disponible : on cherche
    alors n'importe quel seul keyword de nomenclature pour localiser la ligne header.
    """
    if not blocs:
        return None

    sorted_blocs = sorted(blocs, key=lambda b: b["top"])
    groups: list[list[dict]] = []
    current: list[dict] = [sorted_blocs[0]]

    for b in sorted_blocs[1:]:
        if b["top"] - current[-1]["top"] <= _LINE_TOLERANCE:
            current.append(b)
        else:
            groups.append(current)
            current = [b]
    groups.append(current)

    best_y_bottom = None
    best_count = min_keywords - 1

    for group in groups:
        matched_kws = set()
        for b in group:
            for m in _KW_RE.finditer(b["text"]):
                matched_kws.add(m.group().upper().replace(" ", "").replace(".", "").replace("-", ""))
        if len(matched_kws) >= min_keywords and len(matched_kws) > best_count:
            best_count = len(matched_kws)
            best_y_bottom = max(b["top"] + b["height"] for b in group)

    return best_y_bottom


def _cluster_lines(blocs: list[dict]) -> list[int]:
    """
    Regroupe les blocs par ligne textuelle et retourne la liste des Y représentatifs
    (médiane du top de chaque groupe). Tolérance = hauteur médiane des blocs.
    """
    if not blocs:
        return []
    heights = [b["height"] for b in blocs if b["height"] > 0]
    tol = float(np.median(heights)) * 0.6 if heights else 8.0

    sorted_blocs = sorted(blocs, key=lambda b: b["top"])
    groups: list[list[int]] = []
    current = [sorted_blocs[0]["top"]]

    for b in sorted_blocs[1:]:
        if b["top"] - current[-1] <= tol:
            current.append(b["top"])
        else:
            groups.append(current)
            current = [b["top"]]
    groups.append(current)

    return [int(np.median(g)) for g in groups]


def _find_table_rect_cv(gray: np.ndarray, header_x1: int, header_x2: int,
                        header_y1: int) -> tuple[int, int, int, int] | None:
    """
    Cherche le bord supérieur et les bords latéraux du tableau via OpenCV.
    Utilise les lignes horiz détectées dans la bande X du header.
    Retourne (x1, y_top, x2, y_last_horiz) ou None si < 2 lignes trouvées.
    Le bas de table (y2 réel) est calculé par OCR dans _detect_page.
    """
    ih, iw = gray.shape
    margin_x = 60
    col_start = max(0, header_x1 - margin_x)
    col_end   = min(iw, header_x2 + margin_x)
    band_w    = col_end - col_start

    _, bin_inv = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY_INV)

    # Chercher les lignes horiz avec des kernels de taille décroissante jusqu'à en trouver
    line_ys: list[int] = []
    for min_pct in [0.25, 0.15, 0.08]:
        ksize = max(10, int(band_w * min_pct))
        kh = cv2.getStructuringElement(cv2.MORPH_RECT, (ksize, 1))
        horiz_strip = cv2.morphologyEx(bin_inv[:, col_start:col_end], cv2.MORPH_OPEN, kh)
        h_proj = np.sum(horiz_strip, axis=1) // 255
        min_h_px = max(5, ksize // 2)

        line_ys = []
        in_line = False
        for y in range(ih):
            if h_proj[y] > min_h_px:
                if not in_line:
                    line_ys.append(y)
                    in_line = True
            else:
                in_line = False

        lines_near = [y for y in line_ys if y >= header_y1 - 400]
        if len(lines_near) >= 2:
            break
    else:
        return None

    y_top = lines_near[0]

    # y_last : dernière ligne horiz avant un grand saut (fin de table probable)
    if len(lines_near) >= 3:
        gaps = [lines_near[i+1] - lines_near[i] for i in range(len(lines_near)-1)]
        median_gap = float(np.median(gaps))
        y_last = lines_near[-1]
        for i, g in enumerate(gaps):
            if g > max(3.0 * median_gap, 150):
                y_last = lines_near[i]
                break
    else:
        y_last = lines_near[-1]

    # Étendue X des lignes dans [y_top, y_last]
    xs_all: list[int] = []
    for y in line_ys:
        if y_top <= y <= y_last:
            cols = np.where(horiz_strip[max(0,y-2):y+6, :].max(axis=0) > 0)[0]
            if len(cols):
                xs_all.extend([int(cols[0]) + col_start, int(cols[-1]) + col_start])

    if xs_all:
        x1 = max(0, min(xs_all) - 10)
        x2 = min(iw, max(xs_all) + 10)
    else:
        x1, x2 = col_start, col_end

    return (x1, y_top, x2, y_last)


def _compute_table_bbox(blocs: list[dict], y_header_bottom: int, y_header_top: int,
                        header_x1: int, header_x2: int) -> dict:
    """
    Calcule la bbox de la table.
    y_header_bottom : bas du header (les données commencent après)
    y_header_top    : haut du header (y1 de la bbox finale)
    header_x1/x2    : étendue X du header — on filtre les blocs hors de cette zone
                      (évite que les numéros de schéma à gauche ou droite polluent la bbox)
    Arrêt si gap inter-LIGNES > 2.5× espacement médian inter-lignes.
    """
    x_margin = 60  # tolérance latérale en pixels
    table_blocs = [
        b for b in blocs
        if b["top"] >= y_header_bottom
        and b["left"] + b["width"] >= header_x1 - x_margin
        and b["left"] <= header_x2 + x_margin
    ]
    if not table_blocs:
        return {"x1": 0, "y1": y_header_top, "x2": 0, "y2": y_header_bottom}

    # Y représentatifs par ligne (pas par mot)
    line_ys = _cluster_lines(table_blocs)

    if len(line_ys) >= 2:
        gaps = [line_ys[i + 1] - line_ys[i] for i in range(len(line_ys) - 1)]
        median_gap = float(np.median(gaps))
    else:
        median_gap = 0.0

    # Fin de table : premier gap inter-lignes > 2.5× la médiane
    y_fin_line = line_ys[-1]
    if median_gap > 0:
        threshold = 2.5 * median_gap
        for i in range(len(line_ys) - 1):
            if line_ys[i + 1] - line_ys[i] > threshold:
                y_fin_line = line_ys[i]
                break

    in_table = [b for b in table_blocs if b["top"] <= y_fin_line + median_gap]
    if not in_table:
        in_table = table_blocs

    x1 = min(b["left"] for b in in_table)
    x2 = max(b["left"] + b["width"] for b in in_table)
    y2 = max(b["top"] + b["height"] for b in in_table)
    return {"x1": x1, "y1": y_header_top, "x2": x2, "y2": y2}


def _classify_page(blocs: list[dict], bbox: dict | None) -> tuple[str, bool]:
    """
    Retourne (page_type, has_nomenclature).
    Heuristique dessin : blocs courts éparpillés hors bbox = vue éclatée.
    """
    if bbox is None:
        return "view_only", False

    outside = [
        b for b in blocs
        if not (bbox["x1"] <= b["left"] <= bbox["x2"] and bbox["y1"] <= b["top"] <= bbox["y2"])
    ]
    short_outside = [b for b in outside if len(b["text"]) < _SHORT_TEXT_LEN]

    if len(short_outside) >= 3:
        return "mixed", True
    return "nomenclature_only", True


def _find_structured_table(blocs: list[dict]) -> dict | None:
    """
    Fallback pour les catalogues sans ligne header (ex: Motobécane M7).
    Détecte les lignes avec pattern : référence_numérique | qté | texte désignation
    Retourne la bbox de la zone de table ou None.
    Structure M7 : col1=ref (5 chiffres), col2=qté (1-2 chiffres), col3=désignation (texte)
    On cherche ≥ 4 lignes consécutives avec une référence numérique en première colonne.
    """
    if not blocs:
        return None

    # Grouper les blocs par ligne Y
    sorted_blocs = sorted(blocs, key=lambda b: b["top"])
    lines: list[list[dict]] = []
    current: list[dict] = [sorted_blocs[0]]
    for b in sorted_blocs[1:]:
        if b["top"] - current[-1]["top"] <= _LINE_TOLERANCE * 2:
            current.append(b)
        else:
            lines.append(current)
            current = [b]
    lines.append(current)

    # Pour chaque ligne, trouver le bloc le plus à gauche et vérifier si c'est une ref numérique
    structured: list[dict] = []  # lignes validées : {y, x_ref, x_max, line_blocs}
    for line in lines:
        sorted_line = sorted(line, key=lambda b: b["left"])
        # Premier token numérique dans la ligne
        for b in sorted_line:
            t = b["text"].strip().rstrip(".|,")
            if _REF_NUM_RE.match(t):
                rest = [bb for bb in sorted_line if bb["left"] > b["left"] + b["width"]]
                if not rest:
                    break
                # Parmi les tokens après la ref, au moins un doit être une quantité
                # (chiffre court, SE, ARR, ou token contenant un chiffre ≤2 digits)
                qty_ok = any(
                    re.search(r"\b(SE|ARR|AV|\d{1,2})\b", bb["text"], re.I)
                    for bb in rest[:4]
                )
                # La désignation doit contenir un mot alphabétique de >3 chars
                has_desc = any(
                    len(bb["text"]) > 3 and re.search(r"[A-Za-zÀ-ÿ]{3,}", bb["text"])
                    for bb in rest
                )
                if qty_ok and has_desc:
                    structured.append({
                        "y": b["top"],
                        "x_ref": b["left"],
                        "x_max": max(bb["left"] + bb["width"] for bb in sorted_line),
                        "blocs": sorted_line,
                    })
                break

    if len(structured) < 4:
        return None

    # Trouver le cluster le plus dense (gap inter-lignes régulier)
    ys = [s["y"] for s in structured]
    gaps = [ys[i+1] - ys[i] for i in range(len(ys)-1)]
    median_gap = float(np.median(gaps)) if gaps else 30.0

    # Couper au premier grand gap (fin de table)
    end_idx = len(structured)
    for i, g in enumerate(gaps):
        if g > max(3.0 * median_gap, 80):
            end_idx = i + 1
            break

    table_lines = structured[:end_idx]
    if len(table_lines) < 3:
        return None

    x1 = min(s["x_ref"] for s in table_lines) - 10
    x2 = max(s["x_max"] for s in table_lines) + 10
    y1 = table_lines[0]["y"] - 10
    y2 = max(b["top"] + b["height"] for s in table_lines for b in s["blocs"])

    return {"x1": max(0, x1), "y1": max(0, y1), "x2": x2, "y2": y2}


_MIN_LETTERS = re.compile(r'[A-Za-zÀ-ÿ]{2,}')


def _ocr_zone(img_path: str, bbox: dict, for_number: bool = False) -> str | None:
    """
    Crop la zone définie dans le gabarit, applique preprocessing
    (agrandissement x4 + seuillage) et lance un OCR ciblé (PSM 7).
    """
    try:
        pil = Image.open(img_path)
        x1, y1, x2, y2 = bbox["x1"], bbox["y1"], bbox["x2"], bbox["y2"]
        crop = pil.crop((x1, y1, x2, y2))
        crop = crop.resize((crop.width * 4, crop.height * 4), Image.LANCZOS)
        arr = cv2.cvtColor(np.array(crop), cv2.COLOR_RGB2GRAY)
        _, thresh = cv2.threshold(arr, 180, 255, cv2.THRESH_BINARY)
        thresh_img = Image.fromarray(thresh)

        if for_number:
            raw = pytesseract.image_to_string(thresh_img, config='--psm 7')
            digits = re.sub(r"[^\d]", "", raw)
            return digits if digits else None
        else:
            raw = pytesseract.image_to_string(thresh_img, config='--psm 6')
            tokens = []
            for t in raw.split():
                t = t.strip()
                if len(t) >= 3 and _MIN_LETTERS.search(t):
                    cleaned = re.sub(r'^[^A-Za-zÀ-ÿ0-9]+|[^A-Za-zÀ-ÿ0-9\)]+$', '', t)
                    if cleaned and len(cleaned) >= 2:
                        tokens.append(cleaned)
            return " ".join(tokens) if tokens else None
    except Exception:
        return None


def _extract_meta_from_blocks(_blocs: list[dict], column_template: dict | None,
                               img_path: str | None = None) -> dict:
    """
    Extrait le titre et le numéro de page en faisant un OCR ciblé
    (crop + preprocessing) sur les zones définies dans le gabarit.
    Les blocs pleine page ne sont pas utilisés — chaque zone est traitée
    indépendamment directement sur l'image.
    """
    result = {"titre": None, "numero_ocr": None}
    if not column_template or not img_path:
        return result

    title_bbox = column_template.get("title_bbox")
    page_number_bbox = column_template.get("page_number_bbox")

    if title_bbox:
        result["titre"] = _ocr_zone(img_path, title_bbox, for_number=False)
    if page_number_bbox:
        result["numero_ocr"] = _ocr_zone(img_path, page_number_bbox, for_number=True)

    return result


def _detect_page(img_path: str, column_template: dict | None = None) -> dict:
    """
    Pipeline complet de détection pour une page.

    Si column_template est fourni (gabarit de pattern défini par l'utilisateur),
    on assouplit la détection du header : 1 seul keyword suffit au lieu de 2,
    car on sait déjà à quoi ressemble la nomenclature de ce catalogue.
    """
    blocs = _ocr_full_page(img_path)
    meta = _extract_meta_from_blocks(blocs, column_template, img_path)

    # Avec gabarit : min_keywords=1 pour trouver le header même si OCR partiel
    min_kw = 1 if column_template else 2
    y_header = _find_header_line(blocs, min_keywords=min_kw)

    if y_header is None:
        # Fallback : détecter par pattern structurel (catalogue sans header)
        struct_bbox = _find_structured_table(blocs)
        if struct_bbox is None:
            return {
                "page_type": "view_only",
                "has_nomenclature": False,
                "nomenclature_bbox": None,
                "nomenclature_bboxes": [],
                "exclusion_zones": [],
                "raw_ocr_blocks": blocs,
                **meta,
            }
        page_type, has_nomenclature = _classify_page(blocs, struct_bbox)
        named_bbox = {**struct_bbox, "name": "Nomenclature"}
        return {
            "page_type": page_type,
            "has_nomenclature": has_nomenclature,
            "nomenclature_bbox": struct_bbox,
            "nomenclature_bboxes": [named_bbox],
            "exclusion_zones": [struct_bbox],
            "raw_ocr_blocks": blocs,
            **meta,
        }

    # y_header = bas du header ; on cherche aussi le haut et l'étendue X pour la bbox
    header_blocs = [b for b in blocs if _KW_RE.search(b["text"])]
    y_header_top = min(b["top"] for b in header_blocs)
    header_x1 = min(b["left"] for b in header_blocs)
    header_x2 = max(b["left"] + b["width"] for b in header_blocs)

    # OpenCV : trouver les bords du tableau (x1, y_top, x2) depuis les lignes horiz
    pil = Image.open(img_path)
    gray_arr = cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2GRAY)
    cv_rect = _find_table_rect_cv(gray_arr, header_x1, header_x2, y_header_top)

    if cv_rect:
        cv_x1, cv_y1, cv_x2, cv_y_last = cv_rect
        ocr_bbox = _compute_table_bbox(blocs, y_header, cv_y1, cv_x1, cv_x2)
        bbox = {"x1": cv_x1, "y1": cv_y1, "x2": cv_x2, "y2": ocr_bbox["y2"]}
    else:
        bbox = _compute_table_bbox(blocs, y_header, y_header_top, header_x1, header_x2)
    page_type, has_nomenclature = _classify_page(blocs, bbox)
    named_bbox = {**bbox, "name": "Nomenclature"}

    return {
        "page_type": page_type,
        "has_nomenclature": has_nomenclature,
        "nomenclature_bbox": bbox,
        "nomenclature_bboxes": [named_bbox],
        "exclusion_zones": [bbox],
        "raw_ocr_blocks": blocs,
        **meta,
    }


# ── POST /detect ──────────────────────────────────────────────────────────────

async def _stream_detect(catalogue_id: int) -> AsyncGenerator[str, None]:
    db = await _get_db()
    loop = asyncio.get_event_loop()

    try:
        # Charger le gabarit du catalogue s'il existe
        cat_row = await db.fetchrow("SELECT column_template FROM catalogue WHERE id=$1", catalogue_id)
        column_template = None
        if cat_row and cat_row["column_template"]:
            tmpl = cat_row["column_template"]
            column_template = json.loads(tmpl) if isinstance(tmpl, str) else dict(tmpl)

        pages = await db.fetch(
            """SELECT id, numero, image FROM page
               WHERE id_catalogue=$1 AND process_status IN ('pending', 'deskewed')
                 AND (type IS NULL OR type NOT IN ('cover', 'index'))
               ORDER BY numero""",
            catalogue_id,
        )
        total = len(pages)
        yield f"data: {json.dumps({'type': 'start', 'total': total})}\n\n"

        sem = asyncio.Semaphore(WORKERS)

        async def detect_one(row: dict):
            async with sem:
                img_path = str(STORAGE_ROOT / str(catalogue_id) / Path(row["image"]).name)
                return await loop.run_in_executor(
                    _executor, _detect_page, img_path, column_template
                )

        tasks = {asyncio.ensure_future(detect_one(dict(p))): dict(p) for p in pages}
        pending_tasks = set(tasks.keys())

        while pending_tasks:
            done_set, pending_tasks = await asyncio.wait(
                pending_tasks, return_when=asyncio.FIRST_COMPLETED
            )
            for fut in done_set:
                page_row = tasks[fut]
                try:
                    result = fut.result()
                    await db.execute(
                        """UPDATE page SET
                               page_type=$1,
                               has_nomenclature=$2,
                               nomenclature_bbox=$3,
                               nomenclature_bboxes=$4,
                               exclusion_zones=$5,
                               raw_ocr_blocks=$6,
                               process_status='detected',
                               titre=COALESCE($7, titre),
                               numero=COALESCE($8::int, numero)
                           WHERE id=$9""",
                        result["page_type"],
                        result["has_nomenclature"],
                        json.dumps(result["nomenclature_bbox"]) if result["nomenclature_bbox"] else None,
                        json.dumps(result["nomenclature_bboxes"]),
                        json.dumps(result["exclusion_zones"]),
                        json.dumps(result["raw_ocr_blocks"]),
                        result.get("titre"),
                        int(result["numero_ocr"]) if result.get("numero_ocr") and str(result["numero_ocr"]).isdigit() else None,
                        page_row["id"],
                    )
                    yield f"data: {json.dumps({'type': 'page_detected', 'page_id': page_row['id'], 'page_num': page_row['numero'], 'page_type': result['page_type'], 'has_nomenclature': result['has_nomenclature']})}\n\n"
                except Exception as e:
                    yield f"data: {json.dumps({'type': 'page_error', 'page_id': page_row['id'], 'error': str(e)})}\n\n"

        yield f"data: {json.dumps({'type': 'done', 'total': total})}\n\n"

    finally:
        await db.close()


@router.post("/detect")
async def detect_catalogue(catalogue_id: int = Form(...)):
    return StreamingResponse(
        _stream_detect(catalogue_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/extract-meta/page")
async def extract_meta_page(page_id: int = Form(...), column_template: str = Form(None)):
    """
    Extrait titre et numéro de page depuis les raw_ocr_blocks déjà stockés en BDD,
    en appliquant les zones title_bbox / page_number_bbox du gabarit.
    Met à jour page.titre et page.numero (COALESCE : ne remplace pas les valeurs
    saisies manuellement si la zone ne retourne rien).
    """
    db = await _get_db()
    try:
        row = await db.fetchrow("SELECT raw_ocr_blocks, image FROM page WHERE id=$1", page_id)
        if not row:
            return {"error": "Page not found"}

        tmpl = json.loads(column_template) if column_template else None
        blocs = json.loads(row["raw_ocr_blocks"]) if isinstance(row["raw_ocr_blocks"], str) else (row["raw_ocr_blocks"] or [])
        img_path = row["image"] if row["image"] else None
        meta = _extract_meta_from_blocks(blocs, tmpl, img_path=img_path)

        num_raw = meta.get("numero_ocr")
        num_int = int(num_raw) if num_raw and num_raw.isdigit() else None
        await db.execute(
            """UPDATE page SET
                   titre=COALESCE($1, titre),
                   numero=COALESCE($2, numero)
               WHERE id=$3""",
            meta.get("titre"),
            num_int,
            page_id,
        )
        updated = await db.fetchrow("SELECT titre, numero FROM page WHERE id=$1", page_id)
        return {"titre": updated["titre"], "numero": updated["numero"], **meta}
    finally:
        await db.close()
