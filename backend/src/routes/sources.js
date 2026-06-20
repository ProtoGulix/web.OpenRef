import { Router } from 'express'
import pool from '../db/pool.js'

const router = Router()

router.get('/', async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM source ORDER BY id')
  res.json(rows)
})

router.post('/', async (req, res) => {
  const { id, name, url, origine, devise, inc_vat, method, marques, actif } = req.body
  const { rows } = await pool.query(
    `INSERT INTO source (id, name, url, origine, devise, inc_vat, method, marques, actif)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [id, name, url, origine, devise, inc_vat, method, marques, actif ?? true]
  )
  res.status(201).json(rows[0])
})

router.patch('/:id', async (req, res) => {
  const fields = ['name', 'url', 'origine', 'devise', 'inc_vat', 'method', 'marques', 'actif']
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
    `UPDATE source SET ${updates.join(',')} WHERE id=$${values.length} RETURNING *`,
    values
  )
  res.json(rows[0])
})

router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM source WHERE id=$1', [req.params.id])
  res.status(204).end()
})

export default router
