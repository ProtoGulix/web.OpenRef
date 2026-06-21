-- Migration 003 — Support multi-nomenclatures par page
-- Remplace nomenclature_bbox (objet unique) par nomenclature_bboxes (tableau nommé)
-- Format : [{ "name": "Moteur", "x1": 100, "y1": 200, "x2": 800, "y2": 1500 }, ...]
-- Exécuter : psql -U postgres -d openref -f database/migrate_003.sql

-- 1. Migrer nomenclature_bbox → nomenclature_bboxes sur la table page
ALTER TABLE page
    ADD COLUMN IF NOT EXISTS nomenclature_bboxes JSONB DEFAULT '[]'::jsonb;

UPDATE page
SET nomenclature_bboxes = jsonb_build_array(
    nomenclature_bbox || '{"name": "Nomenclature"}'::jsonb
)
WHERE nomenclature_bbox IS NOT NULL
  AND (nomenclature_bboxes IS NULL OR nomenclature_bboxes = '[]'::jsonb);

-- Garder nomenclature_bbox pour compatibilité (peut être droppée plus tard)
-- ALTER TABLE page DROP COLUMN nomenclature_bbox;

-- 2. Ajouter bbox_name dans la table nomenclature pour tracer l'origine
ALTER TABLE nomenclature
    ADD COLUMN IF NOT EXISTS bbox_name VARCHAR(100) DEFAULT 'Nomenclature';
