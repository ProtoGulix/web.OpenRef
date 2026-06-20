import { Router } from 'express'
import pool from '../db/pool.js'

const router = Router()

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

  const { rows } = await pool.query(
    `SELECT r.id, r.part_number, r.description, r.plate_ref, r.qty,
            p.numero AS page_numero, p.image AS page_image, p.thumb AS page_thumb, p.id AS page_id,
            c.name AS catalogue_name, c.marque, c.modele, c.id AS catalogue_id
     FROM reference r
     JOIN page p ON p.id = r.id_page
     JOIN catalogue c ON c.id = p.id_catalogue
     WHERE (r.part_number ILIKE $1 OR r.description ILIKE $2)
     ${marqueFilter}
     ORDER BY r.part_number, r.id
     LIMIT 100`,
    params
  )
  res.json(rows)
})

export default router
