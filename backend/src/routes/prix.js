import { Router } from 'express'
import fetch from 'node-fetch'
import pool from '../db/pool.js'

const router = Router()
const SCRAPER_URL = process.env.SCRAPER_SERVICE_URL || 'http://localhost:8002'
const CACHE_HOURS = 24

router.get('/stream', async (req, res) => {
  const { ref, marque } = req.query
  if (!ref || !marque) return res.status(400).json({ error: 'ref and marque required' })

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('X-Accel-Buffering', 'no')

  // Vérifier cache 24h
  const cutoff = new Date(Date.now() - CACHE_HOURS * 3600 * 1000).toISOString()
  const cached = await pool.query(
    `SELECT p.*, s.name AS source_name
     FROM prix p
     JOIN source s ON s.id = p.source_id
     WHERE p.part_number=$1 AND p.scraped_at > $2`,
    [ref, cutoff]
  )

  if (cached.rows.length > 0) {
    // Grouper par source
    const bySource = {}
    for (const row of cached.rows) {
      if (!bySource[row.source_id]) bySource[row.source_id] = []
      bySource[row.source_id].push({
        link: row.link, price: parseFloat(row.price), name: row.name,
        ref: row.part_number, devise: row.devise, inc_vat: row.inc_vat,
        image: row.image, manufacturer: row.manufacturer, source: row.source_id,
      })
    }
    for (const [site, items] of Object.entries(bySource)) {
      res.write(`data: ${JSON.stringify({ type: 'site_done', site, count: items.length, items, cached: true })}\n\n`)
    }
    res.write(`data: ${JSON.stringify({ type: 'done', time: 0, cached: true })}\n\n`)
    return res.end()
  }

  // Proxy vers scraper service
  const scraperRes = await fetch(`${SCRAPER_URL}/scrape/stream?ref=${ref}&marque=${marque}`)
  const decoder = new TextDecoder()
  let buffer = ''

  for await (const chunk of scraperRes.body) {
    buffer += decoder.decode(chunk, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop()

    for (const part of parts) {
      if (!part.startsWith('data: ')) continue
      const raw = part.slice(6)
      let event
      try { event = JSON.parse(raw) } catch { continue }

      // Archiver les résultats en BDD
      if (event.type === 'site_done' && event.items) {
        for (const item of event.items) {
          await pool.query(
            `INSERT INTO prix (part_number, source_id, price, devise, inc_vat, name, link, image, manufacturer)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [ref, item.source, item.price, item.devise, item.inc_vat, item.name, item.link, item.image, item.manufacturer]
          ).catch(() => {}) // ignorer les erreurs d'archivage
        }
      }

      res.write(`data: ${raw}\n\n`)
    }
  }

  res.end()
})

router.get('/archive/:part_number', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT p.*, s.name AS source_name, s.origine
     FROM prix p
     JOIN source s ON s.id = p.source_id
     WHERE p.part_number=$1
     ORDER BY p.scraped_at DESC
     LIMIT 200`,
    [req.params.part_number]
  )
  res.json(rows)
})

export default router
