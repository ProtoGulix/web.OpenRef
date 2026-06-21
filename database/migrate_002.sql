-- Migration 002 — Nouveau pipeline catalogue (deskew + détection + nomenclature + vues)
-- Remplace l'ancienne architecture bloc/reference par un pipeline structuré.
-- Exécuter : psql -U postgres -d openref -f database/migrate_002.sql

-- ── 1. Enrichissement table page ────────────────────────────────────────────

ALTER TABLE page
    ADD COLUMN IF NOT EXISTS page_type         VARCHAR(20),
    ADD COLUMN IF NOT EXISTS has_nomenclature  BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS nomenclature_bbox JSONB,
    ADD COLUMN IF NOT EXISTS exclusion_zones   JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS deskew_angle      FLOAT,
    ADD COLUMN IF NOT EXISTS raw_ocr_blocks    JSONB,
    ADD COLUMN IF NOT EXISTS process_status    VARCHAR(20) DEFAULT 'pending';

-- page_type : view_only | nomenclature_only | mixed | unknown
-- process_status : pending | deskewed | detected | ocr_done | llm_done | error

-- Migrer l'ancien champ status vers process_status pour les pages existantes
UPDATE page SET process_status = CASE
    WHEN status = 'refs_done'     THEN 'llm_done'
    WHEN status = 'parse_running' THEN 'ocr_done'
    WHEN status = 'done'          THEN 'ocr_done'
    WHEN status = 'ocr_running'   THEN 'pending'
    ELSE 'pending'
END
WHERE process_status IS NULL OR process_status = 'pending';

-- ── 2. Table nomenclature ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS nomenclature (
    id             SERIAL PRIMARY KEY,
    catalogue_id   INT REFERENCES catalogue(id) ON DELETE CASCADE,
    source_page_id INT REFERENCES page(id) ON DELETE SET NULL,
    part_number    VARCHAR(100) NOT NULL,
    description    TEXT,
    ref_no         VARCHAR(50),
    qty            VARCHAR(20),
    remarks        TEXT
);

CREATE INDEX IF NOT EXISTS idx_nomenclature_catalogue ON nomenclature(catalogue_id);
CREATE INDEX IF NOT EXISTS idx_nomenclature_partnum   ON nomenclature(part_number);

-- ── 3. Table references_vues ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS references_vues (
    id               SERIAL PRIMARY KEY,
    page_id          INT REFERENCES page(id) ON DELETE CASCADE,
    part_number      VARCHAR(100),
    qty              VARCHAR(20),
    contexte_groupe  TEXT,
    raw_block        TEXT,
    nomenclature_id  INT REFERENCES nomenclature(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_refvues_page       ON references_vues(page_id);
CREATE INDEX IF NOT EXISTS idx_refvues_partnum    ON references_vues(part_number);
CREATE INDEX IF NOT EXISTS idx_refvues_nomenc     ON references_vues(nomenclature_id);

-- ── 4. Mise à jour job.phase pour refléter les nouvelles phases ──────────────

-- Les nouvelles valeurs possibles de job.phase :
-- 'splitting' | 'splitting_done' | 'deskewing' | 'deskew_done'
-- | 'detecting' | 'detect_done' | 'ocr' | 'ocr_done' | 'done'
-- L'ancien type n'est pas contraint, pas besoin de migration DDL.
