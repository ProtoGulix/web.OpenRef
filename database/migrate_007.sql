-- Groupes de pages : plusieurs pages sources → un schéma de référence + nomenclatures agrégées
CREATE TABLE IF NOT EXISTS groupe (
  id            SERIAL PRIMARY KEY,
  id_catalogue  INTEGER NOT NULL REFERENCES catalogue(id) ON DELETE CASCADE,
  id_page_schema INTEGER REFERENCES page(id) ON DELETE SET NULL,
  titre         VARCHAR(255),
  created_at    TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS groupe_page (
  id_groupe  INTEGER NOT NULL REFERENCES groupe(id) ON DELETE CASCADE,
  id_page    INTEGER NOT NULL REFERENCES page(id) ON DELETE CASCADE,
  PRIMARY KEY (id_groupe, id_page)
);

CREATE INDEX IF NOT EXISTS idx_groupe_catalogue ON groupe(id_catalogue);
CREATE INDEX IF NOT EXISTS idx_groupe_page_page ON groupe_page(id_page);
