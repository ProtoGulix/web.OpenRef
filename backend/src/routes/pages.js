import { Router } from 'express'
import pool from '../db/pool.js'

const router = Router()

router.get('/pages/:id', async (req, res) => {
  // Jointure catalogue pour exposer marque/modele (ex: PricePanel doit filtrer les sources par marque
  // réelle du catalogue, pas une valeur en dur côté frontend).
  // groupe_id : si cette page est la page-schéma d'un groupe (plusieurs pages de nomenclature
  // partageant un même schéma éclaté), l'UI doit charger le groupe plutôt que la page seule —
  // sinon le tableau de références ne contiendrait que celles dont source_page_id = cette page.
  const { rows } = await pool.query(
    `SELECT p.*, c.marque, c.modele,
            (SELECT g.id FROM groupe g WHERE g.id_page_schema = p.id LIMIT 1) AS groupe_id
     FROM page p
     JOIN catalogue c ON c.id = p.id_catalogue
     WHERE p.id = $1`,
    [req.params.id]
  )
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

router.post('/pages/:id/extract-meta', async (req, res) => {
  const { id } = req.params
  const { rows: pages } = await pool.query('SELECT id_catalogue FROM page WHERE id=$1', [id])
  if (!pages[0]) return res.status(404).json({ error: 'Page not found' })
  const { rows: cats } = await pool.query('SELECT column_template FROM catalogue WHERE id=$1', [pages[0].id_catalogue])
  const column_template = cats[0]?.column_template ?? null

  const OCR_URL = process.env.OCR_SERVICE_URL || 'http://ocr-service:8001'
  const form = new URLSearchParams({ page_id: id })
  if (column_template) form.set('column_template', JSON.stringify(column_template))
  const ocrRes = await fetch(`${OCR_URL}/ocr/extract-meta/page`, { method: 'POST', body: form })
  if (!ocrRes.ok) return res.status(502).json({ error: 'OCR service error' })
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

router.post('/pages/:id/rerun-vues', async (req, res) => {
  const { id } = req.params
  const { rows: pages } = await pool.query('SELECT id_catalogue FROM page WHERE id=$1', [id])
  if (!pages[0]) return res.status(404).json({ error: 'Page not found' })
  const { rows: cats } = await pool.query('SELECT column_template FROM catalogue WHERE id=$1', [pages[0].id_catalogue])
  const column_template = cats[0]?.column_template ?? null

  const OCR_URL = process.env.OCR_SERVICE_URL || 'http://ocr-service:8001'
  const form = new URLSearchParams({ page_id: id })
  if (column_template) form.set('column_template', JSON.stringify(column_template))
  const ocrRes = await fetch(`${OCR_URL}/ocr/vues/page`, { method: 'POST', body: form })
  if (!ocrRes.ok) return res.status(502).json({ error: 'OCR service error' })
  const result = await ocrRes.json()
  res.json(result)
})

router.get('/pages/:id/refs-vues', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT rv.id, rv.part_number, rv.qty, rv.contexte_groupe, rv.raw_block, rv.pos_x, rv.pos_y,
            COALESCE(
              json_agg(
                json_build_object(
                  'id', rvn.id,
                  'nomenclature_id', n.id,
                  'join_type', rvn.join_type,
                  'part_number', n.part_number,
                  'ref_no', n.ref_no,
                  'description', n.description
                ) ORDER BY rvn.id
              ) FILTER (WHERE rvn.id IS NOT NULL),
              '[]'
            ) AS liaisons
     FROM references_vues rv
     LEFT JOIN ref_vue_nomenclature rvn ON rvn.ref_vue_id = rv.id
     LEFT JOIN nomenclature n ON n.id = rvn.nomenclature_id
     WHERE rv.page_id = $1
     GROUP BY rv.id
     ORDER BY (rv.part_number ~ '^[0-9]+$') DESC, NULLIF(regexp_replace(rv.part_number, '[^0-9]', '', 'g'), '')::int NULLS LAST`,
    [req.params.id]
  )
  res.json(rows)
})

router.patch('/nomenclature/:id', async (req, res) => {
  const fields = ['part_number', 'description', 'ref_no', 'qty', 'remarks', 'corrige']
  const updates = []
  const values = []
  fields.forEach(f => {
    if (req.body[f] !== undefined) {
      updates.push(`${f}=$${values.length + 1}`)
      const v = req.body[f]
      values.push(typeof v === 'boolean' ? v : (v || null))
    }
  })
  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' })
  values.push(req.params.id)
  const { rows } = await pool.query(
    `UPDATE nomenclature SET ${updates.join(',')} WHERE id=$${values.length} RETURNING *`,
    values
  )
  if (!rows[0]) return res.status(404).json({ error: 'Not found' })
  res.json(rows[0])
})

router.delete('/nomenclature/:id', async (req, res) => {
  await pool.query('DELETE FROM nomenclature WHERE id=$1', [req.params.id])
  res.json({ ok: true })
})

router.patch('/nomenclature-bulk/corrige', async (req, res) => {
  const { ids, corrige } = req.body
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids required' })
  const { rows } = await pool.query(
    `UPDATE nomenclature SET corrige=$1 WHERE id = ANY($2::int[]) RETURNING *`,
    [!!corrige, ids]
  )
  res.json(rows)
})

router.post('/pages/:id/refs-vues', async (req, res) => {
  const { part_number, pos_x, pos_y } = req.body
  if (!part_number) return res.status(400).json({ error: 'part_number required' })
  const pn = String(part_number)
  const { rows } = await pool.query(
    `INSERT INTO references_vues (page_id, part_number, pos_x, pos_y, raw_block)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [req.params.id, pn, pos_x ?? null, pos_y ?? null, pn]
  )
  res.json(rows[0])
})

router.post('/pages/:id/ocr-point', async (req, res) => {
  const { cx, cy, radius = 40 } = req.body
  if (cx == null || cy == null) return res.status(400).json({ error: 'cx, cy required' })
  const OCR_URL = process.env.OCR_SERVICE_URL || 'http://ocr-service:8001'
  const form = new URLSearchParams({ page_id: req.params.id, cx: String(Math.round(cx)), cy: String(Math.round(cy)), radius: String(radius) })
  const ocrRes = await fetch(`${OCR_URL}/ocr/vues/ocr-point`, { method: 'POST', body: form })
  if (!ocrRes.ok) return res.status(502).json({ error: 'OCR error' })
  res.json(await ocrRes.json())
})

// Ajouter une liaison repère → nomenclature
router.post('/refs-vues/:id/nomenclatures', async (req, res) => {
  const { nomenclature_id } = req.body
  if (!nomenclature_id) return res.status(400).json({ error: 'nomenclature_id required' })
  const { rows } = await pool.query(
    `INSERT INTO ref_vue_nomenclature (ref_vue_id, nomenclature_id, join_type)
     VALUES ($1, $2, 'manual')
     ON CONFLICT (ref_vue_id, nomenclature_id) DO NOTHING
     RETURNING *`,
    [req.params.id, nomenclature_id]
  )
  res.json(rows[0] ?? { ref_vue_id: req.params.id, nomenclature_id, join_type: 'manual' })
})

// Retirer une liaison repère → nomenclature
router.delete('/refs-vues/:refVueId/nomenclatures/:nomenclatureId', async (req, res) => {
  await pool.query(
    `DELETE FROM ref_vue_nomenclature WHERE ref_vue_id=$1 AND nomenclature_id=$2`,
    [req.params.refVueId, req.params.nomenclatureId]
  )
  res.json({ ok: true })
})

router.delete('/refs-vues/:id', async (req, res) => {
  await pool.query('DELETE FROM references_vues WHERE id=$1', [req.params.id])
  res.json({ ok: true })
})

export default router
