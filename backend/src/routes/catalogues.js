import { Router } from 'express'
import pool from '../db/pool.js'

const router = Router()

router.get('/', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT c.*, COUNT(p.id)::int AS nb_pages
     FROM catalogue c
     LEFT JOIN page p ON p.id_catalogue = c.id
     GROUP BY c.id
     ORDER BY c.date_import DESC`
  )
  res.json(rows)
})

router.post('/', async (req, res) => {
  const { name, marque, modele, annee_debut, annee_fin, langue } = req.body
  const { rows } = await pool.query(
    `INSERT INTO catalogue (name, marque, modele, annee_debut, annee_fin, langue)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [name, marque, modele, annee_debut, annee_fin, langue || 'fr']
  )
  res.status(201).json(rows[0])
})

router.get('/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM catalogue WHERE id=$1', [req.params.id])
  if (!rows[0]) return res.status(404).json({ error: 'Not found' })
  res.json(rows[0])
})

router.patch('/:id', async (req, res) => {
  const scalarFields = ['name', 'marque', 'modele', 'annee_debut', 'annee_fin', 'langue']
  const jsonFields = ['column_template']
  const updates = []
  const values = []
  scalarFields.forEach(f => {
    if (req.body[f] !== undefined) {
      values.push(req.body[f])
      updates.push(`${f}=$${values.length}`)
    }
  })
  jsonFields.forEach(f => {
    if (req.body[f] !== undefined) {
      values.push(JSON.stringify(req.body[f]))
      updates.push(`${f}=$${values.length}::jsonb`)
    }
  })
  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' })
  values.push(req.params.id)
  const { rows } = await pool.query(
    `UPDATE catalogue SET ${updates.join(',')} WHERE id=$${values.length} RETURNING *`,
    values
  )
  res.json(rows[0])
})

// Relancer l'OCR nomenclature sur toutes les pages du catalogue avec le column_template courant
router.get('/:id/rerun-nomenclature', async (req, res) => {
  const { id } = req.params
  const { rows: cats } = await pool.query('SELECT column_template FROM catalogue WHERE id=$1', [id])
  if (!cats[0]) return res.status(404).json({ error: 'Catalogue not found' })

  const OCR_URL = process.env.OCR_SERVICE_URL || 'http://ocr-service:8001'
  const form = new URLSearchParams({
    catalogue_id: id,
    ...(cats[0].column_template ? { column_template: JSON.stringify(cats[0].column_template) } : {}),
  })

  // Remettre toutes les pages nomenclature à 'detected'
  await pool.query(
    `UPDATE page SET process_status='detected' WHERE id_catalogue=$1 AND has_nomenclature=TRUE`,
    [id]
  )

  // Stream SSE depuis l'OCR service vers le client
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('X-Accel-Buffering', 'no')

  const ocrRes = await fetch(`${OCR_URL}/ocr/nomenclature`, { method: 'POST', body: form })
  if (!ocrRes.ok) { res.write(`data: {"type":"error","msg":"OCR error"}\n\n`); return res.end() }

  const reader = ocrRes.body.getReader()
  const decoder = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    res.write(decoder.decode(value))
  }
  res.end()
})

router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM catalogue WHERE id=$1', [req.params.id])
  res.status(204).end()
})

// Pages d'un catalogue
router.get('/:id/pages', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT p.*,
       (SELECT COUNT(*)::int FROM reference r WHERE r.id_page = p.id AND r.corrige = true) AS nb_corriges,
       (SELECT COUNT(*)::int FROM reference r WHERE r.id_page = p.id) AS nb_refs
     FROM page p
     WHERE p.id_catalogue=$1
     ORDER BY p.numero`,
    [req.params.id]
  )
  res.json(rows)
})

export default router
