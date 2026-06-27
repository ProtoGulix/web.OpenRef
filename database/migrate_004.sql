-- Migration 004 — Ajout colonne corrige dans la table nomenclature
ALTER TABLE nomenclature
  ADD COLUMN IF NOT EXISTS corrige BOOLEAN NOT NULL DEFAULT FALSE;
