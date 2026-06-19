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
| OCR Service | Python FastAPI (EasyOCR + pdfplumber) |
| Scraper Service | Python FastAPI (requests / BeautifulSoup / Playwright) |

---

## Structure du projet

```
/
├── frontend/          # React + Vite
├── backend/           # Node.js + Express
├── ocr-service/       # Python FastAPI — PDF/image → blocs OCR
├── scraper-service/   # Python FastAPI — scraping multi-sites SSE
├── storage/           # Images des pages (gitignore)
└── CLAUDE.md
```

---

## Base de données PostgreSQL

### Tables

**`catalogue`** — un document source importé
- `id`, `name`, `marque` (ex: `landrover`, `motobecane`), `modele`, `annee_debut`, `annee_fin`, `langue`, `date_import`

**`page`** — une page du catalogue
- `id`, `id_catalogue`, `numero`, `titre`, `type` (`cover`/`index`/`schema`/`parts_list`), `image`, `thumb`

**`bloc`** — bloc OCR brut positionné sur la page
- `id`, `id_page`, `block_num`, `pos_left`, `pos_top`, `width`, `height`, `conf` (0-100), `text`

**`reference`** — référence structurée extraite et corrigée
- `id`, `id_page`, `id_bloc`, `plate_ref` (numéro sur schéma), `part_number`, `description`, `qty`, `remarks`, `corrige`, `pos_left`, `pos_top`, `width`, `height`

**`source`** — sources de scraping configurables en BDD
- `id` (ex: `jc`), `name`, `url`, `origine`, `devise`, `inc_vat`, `method` (`api`/`html`/`browser`), `marques` (array), `actif`

**`prix`** — archive des prix scrapés
- `id`, `part_number`, `source_id`, `price`, `devise`, `inc_vat`, `name`, `link`, `image`, `manufacturer`, `scraped_at`

---

## OCR Service (`ocr-service/`)

- `POST /ocr/pdf` — reçoit PDF, retourne pages images + blocs (SSE pour progression)
- `POST /ocr/image` — reçoit image, retourne blocs
- Détection automatique : PDF natif → `pdfplumber` / PDF scanné ou image → `EasyOCR`
- Images stockées dans `/storage/pages/{id_catalogue}/`

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
POST           /api/import              -- upload + OCR (SSE)
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

### Composants clés
- `<PageViewer />` — image + overlay blocs positionnés, cliquable
- `<ReferenceRow />` — ligne éditable avec badge confiance OCR
- `<SiteStatusBadge />` — badge ⏳/✅/❌ par scraper
- `<PricePanel />` — panneau prix SSE avec conversion devise
- `<OcrConfBadge />` — 🔴 < 50 / 🟠 < 80 / 🟢 ≥ 80

---

## Ordre de développement

1. **BDD** — schéma PostgreSQL + données initiales sources LR
2. **OCR Service** — pipeline PDF → images → blocs → BDD
3. **Backend** — endpoints import + pages + références
4. **Admin import/correction** — upload, visualisation, édition
5. **Scraper Service** — méthodes api/html/browser, SSE, filtre marque
6. **Frontend recherche + prix** — recherche, fiche référence, prix live

---

## Contexte et projets liés

- `web.find-lr-parts` — scraper LR existant (React + FastAPI Python), source des scrapers LR
- `web.Catalogue` — prototype PHP avec logique Catalogue/Page/Bloc, source d'inspiration pour l'admin
- `web.ref-and-co/ocr/` — prototype OCR Python (EasyOCR + Tesseract) sur catalogue Motobécane M7
- Les catalogues de test disponibles :
  - `Land_Rover_Series_I_1948-1953_Parts_Catalogue.pdf` — références numériques 5-6 chiffres
  - Catalogue Motobécane M7 — références numériques 5 chiffres, structure label + description
