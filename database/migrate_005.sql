-- Migration 005 — Modèle N-N repères ↔ nomenclature (gestion des variantes)
-- Un repère dans le schéma peut correspondre à plusieurs lignes de nomenclature.
-- Exécuter : psql -U postgres -d openref -f database/migrate_005.sql

-- ── 1. Table de jointure N-N ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ref_vue_nomenclature (
    id               SERIAL PRIMARY KEY,
    ref_vue_id       INT NOT NULL REFERENCES references_vues(id) ON DELETE CASCADE,
    nomenclature_id  INT NOT NULL REFERENCES nomenclature(id) ON DELETE CASCADE,
    join_type        VARCHAR(20) DEFAULT 'manual',  -- 'ref_no' | 'part_number' | 'manual'
    UNIQUE (ref_vue_id, nomenclature_id)
);

CREATE INDEX IF NOT EXISTS idx_rvn_ref_vue    ON ref_vue_nomenclature(ref_vue_id);
CREATE INDEX IF NOT EXISTS idx_rvn_nomenclature ON ref_vue_nomenclature(nomenclature_id);

-- ── 2. Migration des liaisons existantes ─────────────────────────────────────

INSERT INTO ref_vue_nomenclature (ref_vue_id, nomenclature_id, join_type)
SELECT id, nomenclature_id, COALESCE(join_type, 'manual')
FROM references_vues
WHERE nomenclature_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ── 3. On garde references_vues.nomenclature_id pour l'instant (compatibilité)
-- Il sera ignoré en faveur de ref_vue_nomenclature — peut être droppé plus tard.
