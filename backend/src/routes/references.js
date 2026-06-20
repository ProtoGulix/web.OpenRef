import { Router } from 'express'
import pool from '../db/pool.js'

const router = Router()

router.get('/pages/:id/references', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM reference WHERE id_page=$1 ORDER BY plate_ref, id',
    [req.params.id]
  )
  res.json(rows)
})

router.post('/pages/:id/references', async (req, res) => {
  const { plate_ref, part_number, description, qty, remarks, id_bloc, pos_left, pos_top, width, height } = req.body
  const { rows } = await pool.query(
    `INSERT INTO reference (id_page, id_bloc, plate_ref, part_number, description, qty, remarks, pos_left, pos_top, width, height)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [req.params.id, id_bloc, plate_ref, part_number, description, qty, remarks, pos_left, pos_top, width, height]
  )
  res.status(201).json(rows[0])
})

router.patch('/references/:id', async (req, res) => {
  const fields = ['plate_ref', 'part_number', 'description', 'qty', 'remarks', 'corrige', 'pos_left', 'pos_top', 'width', 'height']
  const updates = []
  const values = []
  fields.forEach(f => {
    if (req.body[f] !== undefined) {
      values.push(req.body[f])
      updates.push(`${f}=$${values.length}`)
    }
  })
  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' })
  values.push(req.params.id)
  const { rows } = await pool.query(
    `UPDATE reference SET ${updates.join(',')} WHERE id=$${values.length} RETURNING *`,
    values
  )
  res.json(rows[0])
})

router.delete('/references/:id', async (req, res) => {
  await pool.query('DELETE FROM reference WHERE id=$1', [req.params.id])
  res.status(204).end()
})

export default router
