-- OpenRef — schéma PostgreSQL
-- Exécuter : psql -U postgres -d openref -f schema.sql

CREATE TABLE IF NOT EXISTS catalogue (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(255) NOT NULL,
    marque       VARCHAR(100),
    modele       VARCHAR(100),
    annee_debut  INT,
    annee_fin    INT,
    langue       VARCHAR(10) DEFAULT 'fr',
    date_import  TIMESTAMP DEFAULT NOW(),
    total_pages  INT  -- rempli dès que le splitter a ouvert le PDF
);

CREATE TABLE IF NOT EXISTS page (
    id           SERIAL PRIMARY KEY,
    id_catalogue INT REFERENCES catalogue(id) ON DELETE CASCADE,
    numero       INT,
    titre        VARCHAR(255),
    type         VARCHAR(50),   -- 'cover' | 'index' | 'schema' | 'parts_list'
    image        VARCHAR(500),
    thumb        VARCHAR(500),
    status       VARCHAR(20) DEFAULT 'pending'  -- 'pending' | 'ocr_running' | 'done' | 'error'
);

CREATE TABLE IF NOT EXISTS bloc (
    id           SERIAL PRIMARY KEY,
    id_page      INT REFERENCES page(id) ON DELETE CASCADE,
    block_num    INT,
    pos_left     INT,
    pos_top      INT,
    width        INT,
    height       INT,
    conf         INT,           -- confiance OCR 0-100
    text         TEXT
);

CREATE TABLE IF NOT EXISTS reference (
    id           SERIAL PRIMARY KEY,
    id_page      INT REFERENCES page(id) ON DELETE CASCADE,
    id_bloc      INT REFERENCES bloc(id),
    plate_ref    VARCHAR(20),   -- numéro sur schéma éclaté
    part_number  VARCHAR(100),
    description  TEXT,
    qty          INT,
    remarks      TEXT,
    corrige      BOOLEAN DEFAULT FALSE,
    pos_left     INT,
    pos_top      INT,
    width        INT,
    height       INT
);

CREATE TABLE IF NOT EXISTS source (
    id       VARCHAR(10) PRIMARY KEY,
    name     VARCHAR(100),
    url      VARCHAR(255),
    origine  VARCHAR(5),
    devise   VARCHAR(5),
    inc_vat  BOOLEAN,
    method   VARCHAR(10),       -- 'api' | 'html' | 'browser'
    marques  TEXT[],
    actif    BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS prix (
    id           SERIAL PRIMARY KEY,
    part_number  VARCHAR(100),
    source_id    VARCHAR(10) REFERENCES source(id),
    price        DECIMAL(10,2),
    devise       VARCHAR(5),
    inc_vat      BOOLEAN,
    name         TEXT,
    link         TEXT,
    image        TEXT,
    manufacturer VARCHAR(100),
    scraped_at   TIMESTAMP DEFAULT NOW()
);

-- Suivi des jobs d'import
CREATE TABLE IF NOT EXISTS job (
    id             SERIAL PRIMARY KEY,
    catalogue_id   INT REFERENCES catalogue(id) ON DELETE CASCADE,
    status         VARCHAR(20) DEFAULT 'running',  -- 'running' | 'done' | 'error'
    phase          VARCHAR(20) DEFAULT 'splitting',  -- 'splitting' | 'splitting_done' | 'ocr'
    converted      INT DEFAULT 0,
    pages_done     INT DEFAULT 0,
    pages_total    INT,
    error          TEXT,
    started_at     TIMESTAMP DEFAULT NOW(),
    finished_at    TIMESTAMP
);

-- Index utiles
CREATE INDEX IF NOT EXISTS idx_page_catalogue ON page(id_catalogue);
CREATE INDEX IF NOT EXISTS idx_bloc_page      ON bloc(id_page);
CREATE INDEX IF NOT EXISTS idx_ref_page       ON reference(id_page);
CREATE INDEX IF NOT EXISTS idx_ref_partnum    ON reference(part_number);
CREATE INDEX IF NOT EXISTS idx_prix_partnum   ON prix(part_number);
CREATE INDEX IF NOT EXISTS idx_prix_scraped   ON prix(scraped_at);
