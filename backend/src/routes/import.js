import { Router } from 'express'
import { EventEmitter } from 'events'
import multer from 'multer'
import pool from '../db/pool.js'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } })
const OCR_URL = process.env.OCR_SERVICE_URL || 'http://localhost:8001'

// Bus d'events par jobId — rebroadcast des events OCR vers les clients SSE connectés
const jobBus = new EventEmitter()
jobBus.setMaxListeners(50)


// ---------------------------------------------------------------------------
// Phase 1 : découpage PDF → images + insertion pages BDD (status=pending)
// ---------------------------------------------------------------------------

async function runSplit(jobId, catalogueId, fileBuffer, filename, mimetype) {
  const form = new FormData()
  form.append('file', new Blob([fileBuffer], { type: mimetype }), filename)
  form.append('catalogue_id', String(catalogueId))

  let res
  try {
    res = await fetch(`${OCR_URL}/ocr/split`, { method: 'POST', body: form })
  } catch (e) {
    await pool.query(
      `UPDATE job SET status='error', error=$1, finished_at=NOW() WHERE id=$2`,
      [e.message, jobId]
    )
    return false
  }

  if (!res.ok) {
    const msg = `Split service error: ${res.status}`
    await pool.query(
      `UPDATE job SET status='error', error=$1, finished_at=NOW() WHERE id=$2`,
      [msg, jobId]
    )
    return false
  }

  const decoder = new TextDecoder()
  let buffer = ''

  try {
    const reader = res.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n\n')
      buffer = parts.pop()

      for (const part of parts) {
        if (!part.startsWith('data: ')) continue
        let event
        try { event = JSON.parse(part.slice(6)) } catch { continue }

        if (event.type === 'start') {
          await pool.query(
            `UPDATE job SET phase='splitting', pages_total=$1 WHERE id=$2`,
            [event.total, jobId]
          )
          jobBus.emit(`job:${jobId}`, event)

        } else if (event.type === 'page_created') {
          // Pour les PDF natifs, les blocs arrivent directement dans le split
          if (event.blocs) {
            const { rows } = await pool.query(
              `SELECT id FROM page WHERE id_catalogue=$1 AND numero=$2`,
              [catalogueId, event.page]
            )
            if (rows[0]) {
              for (const b of event.blocs) {
                await pool.query(
                  `INSERT INTO bloc (id_page, block_num, pos_left, pos_top, width, height, conf, text)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                  [rows[0].id, b.block_num, b.left, b.top, b.width, b.height, b.conf, b.text]
                )
              }
              await pool.query(`UPDATE page SET status='done' WHERE id=$1`, [rows[0].id])
            }
          }
          await pool.query(
            `UPDATE job SET converted=converted+1 WHERE id=$1`,
            [jobId]
          )
          jobBus.emit(`job:${jobId}`, event)

        } else if (event.type === 'page_error') {
          jobBus.emit(`job:${jobId}`, event)

        } else if (event.type === 'done') {
          await pool.query(
            `UPDATE job SET phase='splitting_done', pages_total=$1 WHERE id=$2`,
            [event.total, jobId]
          )
          jobBus.emit(`job:${jobId}`, event)
        }
      }
    }
  } catch (e) {
    console.error(`Job ${jobId} split stream error:`, e.message)
    await pool.query(
      `UPDATE job SET status='error', error=$1, finished_at=NOW() WHERE id=$2`,
      [e.message, jobId]
    )
    return false
  }

  return true
}


// ---------------------------------------------------------------------------
// Phase 2 : OCR en pool de threads sur les pages pending en BDD
// ---------------------------------------------------------------------------

async function runOcr(jobId, catalogueId) {
  const form = new FormData()
  form.append('catalogue_id', String(catalogueId))

  let res
  try {
    res = await fetch(`${OCR_URL}/ocr/ocr`, { method: 'POST', body: form })
  } catch (e) {
    await pool.query(
      `UPDATE job SET status='error', error=$1, finished_at=NOW() WHERE id=$2`,
      [e.message, jobId]
    )
    return false
  }

  if (!res.ok) {
    const msg = `OCR service error: ${res.status}`
    await pool.query(
      `UPDATE job SET status='error', error=$1, finished_at=NOW() WHERE id=$2`,
      [msg, jobId]
    )
    return false
  }

  const decoder = new TextDecoder()
  let buffer = ''

  try {
    const reader = res.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n\n')
      buffer = parts.pop()

      for (const part of parts) {
        if (!part.startsWith('data: ')) continue
        let event
        try { event = JSON.parse(part.slice(6)) } catch { continue }

        if (event.type === 'ocr_start') {
          await pool.query(`UPDATE job SET phase='ocr' WHERE id=$1`, [jobId])
          jobBus.emit(`job:${jobId}`, event)

        } else if (event.type === 'page_start') {
          jobBus.emit(`job:${jobId}`, event)

        } else if (event.type === 'page_done') {
          await pool.query(`UPDATE job SET pages_done=pages_done+1 WHERE id=$1`, [jobId])
          jobBus.emit(`job:${jobId}`, event)

        } else if (event.type === 'parse_start') {
          jobBus.emit(`job:${jobId}`, event)

        } else if (event.type === 'parse_done') {
          jobBus.emit(`job:${jobId}`, event)

        } else if (event.type === 'ocr_done') {
          jobBus.emit(`job:${jobId}`, event)

        } else if (event.type === 'page_error') {
          jobBus.emit(`job:${jobId}`, event)

        } else if (event.type === 'done') {
          await pool.query(
            `UPDATE job SET status='done', pages_total=$1, finished_at=NOW() WHERE id=$2`,
            [event.total ?? null, jobId]
          )
          jobBus.emit(`job:${jobId}`, event)
        }
      }
    }
  } catch (e) {
    console.error(`Job ${jobId} OCR stream error:`, e.message)
    await pool.query(
      `UPDATE job SET status='error', error=$1, finished_at=NOW() WHERE id=$2`,
      [e.message, jobId]
    )
    return false
  }

  return true
}


// ---------------------------------------------------------------------------
// Orchestrateur : split puis ocr
// ---------------------------------------------------------------------------

async function runImport(jobId, catalogueId, fileBuffer, filename, mimetype) {
  const splitOk = await runSplit(jobId, catalogueId, fileBuffer, filename, mimetype)
  if (!splitOk) return

  // Vérifier si les pages ont déjà leurs blocs (PDF natif traité dans le split)
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS pending FROM page WHERE id_catalogue=$1 AND status='pending'`,
    [catalogueId]
  )
  if (parseInt(rows[0].pending) === 0) {
    // PDF natif : tout fait dans le split, marquer done directement
    await pool.query(
      `UPDATE job SET status='done', phase='ocr', finished_at=NOW() WHERE id=$1`,
      [jobId]
    )
    return
  }

  await runOcr(jobId, catalogueId)
}


// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// POST /api/import — démarre l'import, répond immédiatement
router.post('/', upload.single('file'), async (req, res) => {
  const { name, marque, modele, annee_debut, annee_fin, langue } = req.body
  if (!req.file) return res.status(400).json({ error: 'No file' })

  const { rows: catRows } = await pool.query(
    `INSERT INTO catalogue (name, marque, modele, annee_debut, annee_fin, langue)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [name, marque, modele, annee_debut || null, annee_fin || null, langue || 'fr']
  )
  const catalogueId = catRows[0].id

  const { rows: jobRows } = await pool.query(
    `INSERT INTO job (catalogue_id) VALUES ($1) RETURNING id`,
    [catalogueId]
  )
  const jobId = jobRows[0].id

  runImport(jobId, catalogueId, req.file.buffer, req.file.originalname, req.file.mimetype)

  res.status(202).json({ jobId, catalogueId })
})


// GET /api/import/:jobId/stream — SSE temps réel
router.get('/:jobId/stream', (req, res) => {
  const jobId = parseInt(req.params.jobId)

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('X-Accel-Buffering', 'no')

  const send = data => res.write(`data: ${JSON.stringify(data)}\n\n`)

  const onEvent = event => {
    send(event)
    if (event.type === 'done' || event.type === 'error') res.end()
  }

  jobBus.on(`job:${jobId}`, onEvent)
  req.on('close', () => jobBus.off(`job:${jobId}`, onEvent))
})


// GET /api/import/all — liste tous les jobs (doit être avant /:jobId)
router.get('/all', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT j.*, c.name AS catalogue_name, c.marque
     FROM job j JOIN catalogue c ON c.id = j.catalogue_id
     ORDER BY j.started_at DESC`
  )
  res.json(rows)
})


// GET /api/import/:jobId/status
router.get('/:jobId/status', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT j.*, c.name AS catalogue_name, c.marque
     FROM job j JOIN catalogue c ON c.id = j.catalogue_id
     WHERE j.id=$1`,
    [req.params.jobId]
  )
  if (!rows[0]) return res.status(404).json({ error: 'Job introuvable' })
  res.json(rows[0])
})


// GET /api/import/:jobId/progress — SSE basé sur polling BDD
router.get('/:jobId/progress', async (req, res) => {
  const jobId = parseInt(req.params.jobId)

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('X-Accel-Buffering', 'no')

  let lastState = ''
  const send = data => res.write(`data: ${JSON.stringify(data)}\n\n`)

  const tick = async () => {
    const { rows } = await pool.query(
      `SELECT j.*, c.name AS catalogue_name FROM job j
       JOIN catalogue c ON c.id = j.catalogue_id WHERE j.id=$1`,
      [jobId]
    )
    if (!rows[0]) { clearInterval(timer); return res.end() }
    const job = rows[0]

    const state = `${job.phase}:${job.converted}:${job.pages_done}`
    if (state !== lastState) {
      lastState = state
      send({ type: 'progress', phase: job.phase, converted: job.converted, pages_done: job.pages_done, pages_total: job.pages_total, status: job.status })
    }

    if (job.status === 'done') {
      send({ type: 'done', pages_done: job.pages_done, pages_total: job.pages_total })
      clearInterval(timer)
      res.end()
    } else if (job.status === 'error') {
      send({ type: 'error', error: job.error })
      clearInterval(timer)
      res.end()
    }
  }

  const timer = setInterval(tick, 1000)
  tick()
  req.on('close', () => clearInterval(timer))
})

export default router
