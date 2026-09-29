import { Router } from 'express'
import pool from '../db/pool.js'

const router = Router()

// Chiffres clés pour la page d'accueil — une seule requête agrégée (sous-requêtes scalaires).
router.get('/', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM catalogue)                    AS catalogues,
       (SELECT COUNT(*) FROM page)                          AS pages,
       (SELECT COUNT(*) FROM nomenclature)                  AS references_extraites,
       (SELECT COUNT(*) FROM nomenclature WHERE corrige)    AS references_corrigees`
  )
  const row = rows[0]

  // Exemples de recherche pour le hero : quelques part_number réels et corrigés (fiables),
  // tirés au hasard. Repli côté frontend sur une liste fixe si ce tableau est vide.
  const { rows: exemplesRows } = await pool.query(
    `SELECT part_number FROM (
       SELECT DISTINCT part_number FROM nomenclature
       WHERE corrige = true AND part_number IS NOT NULL AND part_number != ''
     ) d
     ORDER BY random()
     LIMIT 4`
  )

  // Catalogue ayant le plus de références encore à corriger — cible du lien "Références corrigées"
  // vers l'espace admin de correction le plus utile.
  const { rows: aCorrigerRows } = await pool.query(
    `SELECT c.id
     FROM catalogue c
     JOIN nomenclature n ON n.catalogue_id = c.id
     WHERE NOT n.corrige
     GROUP BY c.id
     ORDER BY COUNT(*) DESC
     LIMIT 1`
  )

  res.json({
    catalogues: Number(row.catalogues),
    pages: Number(row.pages),
    references_extraites: Number(row.references_extraites),
    references_corrigees: Number(row.references_corrigees),
    exemples: exemplesRows.map(r => r.part_number),
    catalogue_a_corriger_id: aCorrigerRows[0]?.id ?? null,
  })
})

export default router
