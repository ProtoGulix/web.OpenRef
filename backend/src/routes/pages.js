import { Router } from 'express'
import pool from '../db/pool.js'

const router = Router()

router.get('/pages/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM page WHERE id=$1', [req.params.id])
  if (!rows[0]) return res.status(404).json({ error: 'Not found' })
  res.json(rows[0])
})

const NO_NOMENCLATURE_TYPES = new Set(['cover', 'index'])
const JSONB_FIELDS = new Set(['nomenclature_bbox', 'nomenclature_bboxes'])

router.patch('/pages/:id', async (req, res) => {
  const fields = ['titre', 'type', 'numero', 'nomenclature_bbox', 'nomenclature_bboxes']
  const updates = []
  const values = []
  fields.forEach(f => {
    if (req.body[f] !== undefined) {
      values.push(JSONB_FIELDS.has(f) ? JSON.stringify(req.body[f]) : req.body[f])
      updates.push(`${f}=$${values.length}${JSONB_FIELDS.has(f) ? '::jsonb' : ''}`)
    }
  })
  if (req.body.type !== undefined && NO_NOMENCLATURE_TYPES.has(req.body.type)) {
    updates.push('has_nomenclature=FALSE')
  }
  if (req.body.nomenclature_bboxes !== undefined) {
    const hasAny = Array.isArray(req.body.nomenclature_bboxes) && req.body.nomenclature_bboxes.length > 0
    updates.push(`has_nomenclature=${hasAny}`)
  }
  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' })
  values.push(req.params.id)
  const { rows } = await pool.query(
    `UPDATE page SET ${updates.join(',')} WHERE id=$${values.length} RETURNING *`,
    values
  )
  res.json(rows[0])
})

router.get('/pages/:id/blocs', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM bloc WHERE id_page=$1 ORDER BY block_num',
    [req.params.id]
  )
  res.json(rows)
})

router.post('/pages/:id/rerun-nomenclature', async (req, res) => {
  const { id } = req.params
  // Remettre process_status à 'detected' pour que l'OCR service le prenne
  await pool.query(`UPDATE page SET process_status='detected' WHERE id=$1`, [id])
  // Appeler l'OCR service sur cette page uniquement
  const OCR_URL = process.env.OCR_SERVICE_URL || 'http://ocr-service:8001'
  const form = new URLSearchParams({ page_id: id })
  const ocrRes = await fetch(`${OCR_URL}/ocr/nomenclature/page`, { method: 'POST', body: form })
  const result = await ocrRes.json()
  res.json(result)
})

router.get('/pages/:id/nomenclature', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM nomenclature WHERE source_page_id=$1 ORDER BY id`,
    [req.params.id]
  )
  res.json(rows)
})

export default router
