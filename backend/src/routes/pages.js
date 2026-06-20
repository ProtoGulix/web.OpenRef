import { Router } from 'express'
import pool from '../db/pool.js'

const router = Router()

router.get('/pages/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM page WHERE id=$1', [req.params.id])
  if (!rows[0]) return res.status(404).json({ error: 'Not found' })
  res.json(rows[0])
})

router.patch('/pages/:id', async (req, res) => {
  const fields = ['titre', 'type', 'numero']
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

export default router
