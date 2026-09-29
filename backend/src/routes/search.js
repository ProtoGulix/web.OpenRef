import { Router } from 'express'
import pool from '../db/pool.js'

const router = Router()

// Recherche principale : interroge `nomenclature` (table réellement peuplée par le pipeline OCR)
// et non `reference` (ancienne table, quasi vide depuis le nouveau pipeline détection/nomenclature/vues).
router.get('/', async (req, res) => {
  const { q, marque } = req.query
  if (!q || q.trim().length < 2) return res.status(400).json({ error: 'q too short' })

  const term = `%${q.trim()}%`
  const params = [term, term]
  let marqueFilter = ''
  if (marque) {
    params.push(marque)
    marqueFilter = `AND c.marque = $${params.length}`
  }

  // `nomenclature` n'a pas de position propre (c'est une ligne de texte de tableau) : sa
  // `source_page_id` est la page où le TEXTE a été lu, pas forcément celle du schéma éclaté.
  // Le repère `references_vues` lié (via ref_vue_nomenclature) vit souvent sur une AUTRE page
  // (le schéma), avec sa position pos_x/pos_y — c'est cette page-là qu'il faut ouvrir pour
  // afficher la référence surlignée. On expose donc les deux pages séparément.
  const { rows } = await pool.query(
    `SELECT n.id, n.part_number, n.description, n.ref_no AS plate_ref, n.qty, n.corrige,
            p.numero AS page_numero, p.image AS page_image, p.thumb AS page_thumb, p.id AS page_id,
            c.name AS catalogue_name, c.marque, c.modele, c.id AS catalogue_id,
            rv.id AS repere_id, rv.pos_x, rv.pos_y,
            rvp.id AS repere_page_id, rvp.numero AS repere_page_numero,
            rvp.image AS repere_page_image, rvp.thumb AS repere_page_thumb,
            COUNT(*) OVER (PARTITION BY n.part_number, n.catalogue_id, p.numero) AS doublon_count
     FROM nomenclature n
     JOIN catalogue c ON c.id = n.catalogue_id
     LEFT JOIN page p ON p.id = n.source_page_id
     LEFT JOIN LATERAL (
       SELECT rv.id, rv.pos_x, rv.pos_y, rv.page_id
       FROM ref_vue_nomenclature rvn
       JOIN references_vues rv ON rv.id = rvn.ref_vue_id
       WHERE rvn.nomenclature_id = n.id
       ORDER BY rv.id
       LIMIT 1
     ) rv ON true
     LEFT JOIN page rvp ON rvp.id = rv.page_id
     WHERE (n.part_number ILIKE $1 OR n.description ILIKE $2)
     ${marqueFilter}
     ORDER BY n.part_number, n.id
     LIMIT 100`,
    params
  )

  // `doublon_count` (agrégat de fenêtrage) revient sous forme de string BIGINT — normaliser en bool
  const normalized = rows.map(r => ({
    ...r,
    doublon: Number(r.doublon_count) > 1,
    doublon_count: undefined,
  }))

  if (normalized.length > 0) return res.json(normalized)

  // 0 résultat exact : proposer des références proches par similarité trigram (pg_trgm)
  // sur le seul terme de recherche (utile surtout pour une référence, moins pour une description longue).
  const suggestions = await fetchSuggestions(q.trim(), marque)

  // Indique si la marque choisie n'a simplement aucune référence extraite (catalogue pas encore traité)
  let marqueVide = false
  if (marque) {
    const { rows: check } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM nomenclature n JOIN catalogue c ON c.id = n.catalogue_id WHERE c.marque = $1`,
      [marque]
    )
    marqueVide = check[0].n === 0
  }

  res.json({ results: [], suggestions, marqueVide })
})

// Recherche floue dédiée, utilisable indépendamment (ex: bouton "voir des références proches")
router.get('/suggest', async (req, res) => {
  const { q, marque } = req.query
  if (!q || q.trim().length < 2) return res.status(400).json({ error: 'q too short' })
  res.json(await fetchSuggestions(q.trim(), marque))
})

async function fetchSuggestions(q, marque) {
  const params = [q, 0.3]
  let marqueFilter = ''
  if (marque) {
    params.push(marque)
    marqueFilter = `AND c.marque = $${params.length}`
  }
  const { rows } = await pool.query(
    `SELECT n.id, n.part_number, n.description,
            c.name AS catalogue_name, c.marque, c.modele, c.id AS catalogue_id,
            similarity(n.part_number, $1) AS score
     FROM nomenclature n
     JOIN catalogue c ON c.id = n.catalogue_id
     WHERE similarity(n.part_number, $1) > $2
     ${marqueFilter}
     ORDER BY score DESC
     LIMIT 5`,
    params
  )
  return rows
}

export default router
