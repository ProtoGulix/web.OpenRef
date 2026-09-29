-- Migration 009 — Recherche floue sur les références (page d'accueil)
-- Ajoute pg_trgm pour proposer des références proches quand la recherche exacte ne donne rien.
-- Exécuter : psql -U postgres -d openref -f database/migrate_009.sql

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Index trigram pour accélérer similarity()/ILIKE sur les part_number de la nomenclature
-- (table qui contient les vraies références extraites — `reference` est l'ancienne table, quasi vide)
CREATE INDEX IF NOT EXISTS idx_nomenclature_partnum_trgm
    ON nomenclature USING GIN (part_number gin_trgm_ops);
