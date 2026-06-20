-- Migration 001 — pipeline import en deux phases (split + ocr)
-- Exécuter : psql -U postgres -d openref -f database/migrate_001.sql

ALTER TABLE catalogue
    ADD COLUMN IF NOT EXISTS total_pages INT;

ALTER TABLE page
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending';

-- Marquer les pages existantes comme déjà traitées
UPDATE page SET status = 'done' WHERE status IS NULL;

-- Mettre à jour total_pages pour les catalogues existants
UPDATE catalogue c
SET total_pages = (SELECT COUNT(*) FROM page p WHERE p.id_catalogue = c.id);

-- Corriger la valeur par défaut de job.phase
ALTER TABLE job
    ALTER COLUMN phase SET DEFAULT 'splitting';
