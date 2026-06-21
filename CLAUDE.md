# OpenRef — CLAUDE.md

## Présentation du projet

**OpenRef** est un agrégateur de catalogues de pièces détachées couplé à un comparateur de prix en temps réel.
L'utilisateur importe un catalogue (PDF scanné ou natif, photos), l'OCR extrait les références et descriptions,
un espace admin permet de corriger les données, puis la recherche permet de trouver une pièce et de comparer
les prix chez plusieurs fournisseurs en temps réel.

Licence : **CC BY-NC 4.0** — libre mais non commercial.

---

## Stack technique

| Couche | Techno |
|---|---|
| Frontend | React (Vite) + Bulma CSS |
| Backend | Node.js + Express (API REST + SSE) |
| Base de données | PostgreSQL |
| OCR Service | Python FastAPI (Tesseract + pdfplumber) |
| Parse Service | Ollama `qwen2.5:7b` (conteneur Docker, port 11434) |
| Scraper Service | Python FastAPI (requests / BeautifulSoup / Playwright) |

---

## Structure du projet

```
/
├── frontend/          # React + Vite
├── backend/           # Node.js + Express
├── ocr-service/       # Python FastAPI — PDF/image → blocs OCR + parse références
├── scraper-service/   # Python FastAPI — scraping multi-sites SSE
├── storage/           # Images des pages (gitignore)
├── database/
│   ├── schema.sql
│   ├── seed.sql
│   └── migrate_001.sql
└── CLAUDE.md
```

---

## Base de données PostgreSQL

### Tables

**`catalogue`** — un document source importé
- `id`, `name`, `marque` (ex: `landrover`, `motobecane`), `modele`, `annee_debut`, `annee_fin`, `langue`, `date_import`, `total_pages`

**`page`** — une page du catalogue
- `id`, `id_catalogue`, `numero`, `titre`, `type` (`cover`/`index`/`schema`/`parts_list`), `image`, `thumb`
- `status` : `pending` → `ocr_running` → `done` → `refs_done` / `error`

**`bloc`** — bloc OCR brut positionné sur la page
- `id`, `id_page`, `block_num`, `pos_left`, `pos_top`, `width`, `height`, `conf` (0-100), `text`

**`reference`** — référence structurée extraite et corrigée
- `id`, `id_page`, `id_bloc`, `plate_ref` (numéro sur schéma), `part_number`, `description`, `qty`, `remarks`, `corrige`, `pos_left`, `pos_top`, `width`, `height`

**`job`** — suivi des jobs d'import
- `id`, `catalogue_id`, `status` (`running`/`done`/`error`), `phase` (`splitting`/`splitting_done`/`ocr`), `converted`, `pages_done`, `pages_total`, `error`, `started_at`, `finished_at`

**`source`** — sources de scraping configurables en BDD
- `id` (ex: `jc`), `name`, `url`, `origine`, `devise`, `inc_vat`, `method` (`api`/`html`/`browser`), `marques` (array), `actif`

**`prix`** — archive des prix scrapés
- `id`, `part_number`, `source_id`, `price`, `devise`, `inc_vat`, `name`, `link`, `image`, `manufacturer`, `scraped_at`

### Migrations appliquées
- `migrate_001.sql` — ajout `catalogue.total_pages`, `page.status`, correction `job.phase` default

---

## Pipeline d'import — Architecture séquentielle

Chaque phase est un endpoint SSE indépendant. `process_status` dans `page` permet de reprendre sans tout relancer.

```
PDF → [1] split → [2] deskew (intégré au split) → [3] detect → [4] nomenclature → [6] vues → [7] jointure
```

### [1+2] Split + Deskew (`POST /ocr/split`)
- Reçoit le PDF + `catalogue_id`
- Convertit chaque page en JPEG **300 DPI** (4 threads parallèles)
- Détecte et corrige l'angle de rotation (Hough, seuil ≥ 0.3°) — l'image stockée EST l'image deskewée
- Insère `page` avec `process_status='deskewed'`, `deskew_angle`, chemin image
- Stream SSE : `start`, `page_created`, `page_error`, `done`

### [3] Détection nomenclature (`POST /ocr/detect`)
- OCR rapide pleine page (psm 6)
- Détecte header tableau par mots-clés (PART NUMBER, DESCRIPTION, REF NO, QTY, ILL, REMARKS)
- Calcule `nomenclature_bbox` via espacement médian inter-lignes (gap > 2.5× = fin de table)
- Type la page : `view_only` / `nomenclature_only` / `mixed`
- Initialise `exclusion_zones = [nomenclature_bbox]`
- `process_status = 'detected'`
- Stream SSE : `start`, `page_detected`, `page_error`, `done`

### [4+5] OCR nomenclature (`POST /ocr/nomenclature`)
- Pages avec `has_nomenclature=TRUE` et `process_status='detected'`
- OCR psm 6 ciblé sur `nomenclature_bbox` (crop + 5px marge)
- Regroupement blocs par Y (tolérance ± demi-hauteur médiane) → lignes
- Split colonnes : `part_number | description | ref_no [| qty | remarks]`
- Normalisation part_number (espaces parasites : `AAU  1053` → `AAU1053`)
- Insertion en `nomenclature` (lié à `catalogue_id`)
- `process_status = 'ocr_done'`
- Stream SSE : `start`, `page_done`, `page_error`, `done`

### [6] OCR vues éclatées (`POST /ocr/vues`)
- Toutes les pages `process_status IN ('detected', 'ocr_done')`
- Masque les `exclusion_zones` (rectangle blanc sur copie — image stockée non modifiée)
- OCR psm 11 (sparse text) sur image masquée
- Extraction regex références : `[A-Z]{1,4}\d{4,8}[A-Z]?`, `\d{6,9}`, `[A-Z]{2,4}\s?\d{3,5}`
- Quantité `\((\d+)\)` dans le bloc ou bloc adjacent (Y ± 15px)
- Détection `GROUP [A-Z0-9]+` comme `contexte_groupe`
- Insertion en `references_vues`
- Stream SSE : `start`, `page_done`, `page_error`, `done`

### [7] Jointure (`POST /ocr/jointure`)
- UPDATE `references_vues.nomenclature_id` par jointure `part_number` exact sur `nomenclature` du même catalogue
- Réponse JSON (pas de SSE) : `{matched, total}`

### Orchestration backend (`POST /api/import`)
1. Crée le catalogue + job en BDD
2. Appelle `POST /ocr/split` → SSE
3. Appelle `POST /ocr/detect` → SSE
4. Appelle `POST /ocr/nomenclature` → SSE (pages avec nomenclature)
5. Appelle `POST /ocr/vues` → SSE (toutes les pages)
6. Appelle `POST /ocr/jointure` → JSON
7. Marque job `done`

---

## OCR Service (`ocr-service/`)

Routers (`ocr-service/routers/`) :
- `split.py`        → `POST /ocr/split`, `POST /ocr/deskew`
- `detect.py`       → `POST /ocr/detect`
- `nomenclature.py` → `POST /ocr/nomenclature`
- `vues.py`         → `POST /ocr/vues`, `POST /ocr/jointure`

Dépendances Python : `fastapi`, `uvicorn`, `pytesseract`, `pdf2image`, `pdfplumber`, `Pillow`, `numpy`, `opencv-python-headless`, `asyncpg`

---

## Scraper Service (`scraper-service/`)

- `GET /scrape/stream?ref=ERR6066&marque=landrover` — SSE, résultats au fur et à mesure
- **3 méthodes** selon la source configurée en BDD :
  - `api` — endpoint JSON dédié (Algolia, Doofinder, Clerk.io...)
  - `html` — `requests` + `BeautifulSoup` sur page de résultats
  - `browser` — `Playwright` pour sites JS dynamiques
- Les sources sont **filtrées par marque** — on ne scrape jamais un site LR pour une ref Motobécane
- Cache prix : si un prix existe en BDD avec `scraped_at` < 24h, on ne re-scrape pas

### Événements SSE
```
{ type: 'change', change: { EURGBP, GBPEUR } }
{ type: 'site_start', site: 'jc' }
{ type: 'site_done', site: 'jc', count: 2, items: [...] }
{ type: 'site_error', site: 'jc', error: 'timeout' }
{ type: 'done', time: 4.2 }
```

### Sources initiales (Land Rover)
| id | Nom | Méthode | Devise |
|---|---|---|---|
| jc | JohnCraddock | api | GBP |
| lp | LRParts | api | GBP |
| ls | LandService | api | EUR |
| bol | BestOfLand | api | EUR |
| rp | RoverParts | api | GBP |
| sf | SeriesForever | html | EUR |
| pad | PaddockSpares | html | GBP |
| bp | BritishParts | html | GBP |

---

## Backend Node.js (`backend/`)

Endpoints principaux :
```
GET/POST       /api/catalogues
GET/PATCH      /api/catalogues/:id
GET            /api/catalogues/:id/pages
GET/PATCH      /api/pages/:id
GET            /api/pages/:id/blocs
GET/POST/PATCH /api/pages/:id/references
DELETE         /api/references/:id
GET/POST/PATCH /api/sources
POST           /api/import              -- upload + split + OCR (SSE)
GET            /api/import/:jobId/stream   -- SSE temps réel (page_created, page_done...)
GET            /api/import/:jobId/progress -- SSE polling BDD
GET            /api/import/:jobId/status
GET            /api/import/all
GET            /api/prix/stream         -- scraping live (SSE)
GET            /api/prix/archive/:part_number
GET            /api/search?q=...&marque=...
```

---

## Frontend React (`frontend/`)

### Pages
| Route | Description |
|---|---|
| `/` | Recherche globale par description ou référence |
| `/catalogues` | Liste des catalogues importés |
| `/catalogue/:id` | Grille des pages d'un catalogue |
| `/page/:id` | Image + overlay + tableau références |
| `/ref/:part_number` | Fiche pièce + prix live SSE |
| `/admin/import` | Upload PDF + progression OCR SSE |
| `/admin/catalogue/:id` | Suivi correction pages |
| `/admin/page/:id/edit` | Éditeur côte à côte image / tableau |
| `/admin/sources` | Gestion des sources de scraping |
| `/admin/jobs` | Suivi des jobs d'import (grille pages par statut) |

### Composants clés
- `<PageViewer />` — image + overlay blocs positionnés, cliquable
- `<ReferenceRow />` — ligne éditable avec badge confiance OCR
- `<SiteStatusBadge />` — badge ⏳/✅/❌ par scraper
- `<PricePanel />` — panneau prix SSE avec conversion devise
- `<OcrConfBadge />` — 🔴 < 50 / 🟠 < 80 / 🟢 ≥ 80
- `<ProgressOcr />` — barre de progression import (events `page_done`, `start`, `done`)

### Suivi de job (`AdminJobsPage`)
- Polling BDD toutes les 5s via `GET /api/catalogues/:id/pages` pendant que le job tourne
- SSE optimiste via `/api/import/:jobId/stream` pour mise à jour immédiate par page
- Couleurs grille : jaune=`pending`, bleu=`ocr_running`, vert=`done`

---

## Infrastructure

### Environnement de dev
Le projet tourne intégralement sur la **VM NAS Debian** (`192.168.1.161`, 32 Go RAM).
Le dev se fait via **VS Code Remote SSH** connecté à la VM.
Docker Compose gère tous les services y compris Ollama.

### Docker Compose
- `db` — PostgreSQL 16, port 5432
- `ollama` — port 11434, volume `ollama_models` (modèles persistés)
- `ocr-service` — port 8001, `OLLAMA_URL=http://ollama:11434`, `OLLAMA_MODEL=qwen2.5:7b`
- `scraper-service` — port 8002
- `backend` — port 3001, `OCR_SERVICE_URL=http://ocr-service:8001`
- `frontend` — port 3000, proxy Vite → backend (`changeOrigin: true`, timeout 120s)

### Premier démarrage sur la VM
```bash
docker compose up -d
# Télécharger le modèle (~4.7 Go, une seule fois)
docker exec ollama ollama pull qwen2.5:7b
```
Le modèle est persisté dans le volume `ollama_models` — pas besoin de re-télécharger.

---

## Ordre de développement

1. ✅ **BDD** — schéma PostgreSQL + données initiales sources LR
2. ✅ **OCR Service** — pipeline complet : split/deskew, détection, OCR nomenclature, OCR vues, jointure
3. ✅ **Backend** — endpoints import + pages + références
4. ✅ **Admin import/correction** — upload, visualisation, suivi job temps réel
5. 🔲 **Backend orchestration** — câbler les 5 nouvelles phases dans `POST /api/import`
6. 🔲 **LLM (phase ultérieure)** — Ollama qwen2.5:7b sur `raw_ocr_blocks` pages view_only/mixed
7. 🔲 **Scraper Service** — méthodes api/html/browser, SSE, filtre marque
8. 🔲 **Frontend recherche + prix** — recherche, fiche référence, prix live

### Migrations BDD appliquées
- `migrate_001.sql` — ajout `catalogue.total_pages`, `page.status`, correction `job.phase` default
- `migrate_002.sql` — nouveau pipeline : `page` enrichi (page_type, has_nomenclature, nomenclature_bbox, exclusion_zones, deskew_angle, raw_ocr_blocks, process_status), tables `nomenclature` et `references_vues`

---

## Contexte et projets liés

- `web.find-lr-parts` — scraper LR existant (React + FastAPI Python), source des scrapers LR
- `web.Catalogue` — prototype PHP avec logique Catalogue/Page/Bloc, source d'inspiration pour l'admin
- `web.ref-and-co/ocr/` — prototype OCR Python (EasyOCR + Tesseract) sur catalogue Motobécane M7
- Les catalogues de test disponibles :
  - `Land_Rover_Series_I_1948-1953_Parts_Catalogue.pdf` — références numériques 5-6 chiffres, 452 pages
  - Catalogue Motobécane M7 — références numériques 5 chiffres, structure label + description
