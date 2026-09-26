-- Migration 008 : zones de nomenclature et pattern colonne par page-dans-groupe
ALTER TABLE groupe_page
  ADD COLUMN IF NOT EXISTS nomenclature_bboxes JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS column_template     JSONB DEFAULT NULL;
