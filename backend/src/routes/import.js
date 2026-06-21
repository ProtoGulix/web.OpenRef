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
// Helper : appel SSE générique vers l'OCR service
// ---------------------------------------------------------------------------

async function runOcrPhase(jobId, endpoint, catalogueId, phase, onEvent) {
  const form = new FormData()
  form.append('catalogue_id', String(catalogueId))

  await pool.query(`UPDATE job SET phase=$1 WHERE id=$2`, [phase, jobId])

  let res
  try {
    res = await fetch(`${OCR_URL}${endpoint}`, { method: 'POST', body: form })
  } catch (e) {
    await pool.query(
      `UPDATE job SET status='error', error=$1, finished_at=NOW() WHERE id=$2`,
      [e.message, jobId]
    )
    return false
  }

  if (!res.ok) {
    const msg = `${endpoint} error: ${res.status}`
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
        await onEvent(event)
        jobBus.emit(`job:${jobId}`, event)
      }
    }
  } catch (e) {
    console.error(`Job ${jobId} ${endpoint} stream error:`, e.message)
    await pool.query(
      `UPDATE job SET status='error', error=$1, finished_at=NOW() WHERE id=$2`,
      [e.message, jobId]
    )
    return false
  }

  return true
}


// ---------------------------------------------------------------------------
// Orchestrateur : split → detect → nomenclature → vues → jointure
// ---------------------------------------------------------------------------

async function runImport(jobId, catalogueId, fileBuffer, filename, mimetype) {
  // [1+2] Split + deskew
  const splitOk = await runSplit(jobId, catalogueId, fileBuffer, filename, mimetype)
  if (!splitOk) return

  // [3] Détection nomenclature
  const detectOk = await runOcrPhase(jobId, '/ocr/detect', catalogueId, 'detecting', async (event) => {
    if (event.type === 'page_detected') {
      await pool.query(`UPDATE job SET pages_done=pages_done+1 WHERE id=$1`, [jobId])
    }
  })
  if (!detectOk) return

  await pool.query(`UPDATE job SET pages_done=0 WHERE id=$1`, [jobId])

  // [4+5] OCR nomenclature
  const nomenclatureOk = await runOcrPhase(jobId, '/ocr/nomenclature', catalogueId, 'ocr_nomenclature', async (event) => {
    if (event.type === 'page_done') {
      await pool.query(`UPDATE job SET pages_done=pages_done+1 WHERE id=$1`, [jobId])
    }
  })
  if (!nomenclatureOk) return

  await pool.query(`UPDATE job SET pages_done=0 WHERE id=$1`, [jobId])

  // [6] OCR vues
  const vuesOk = await runOcrPhase(jobId, '/ocr/vues', catalogueId, 'ocr_vues', async (event) => {
    if (event.type === 'page_done') {
      await pool.query(`UPDATE job SET pages_done=pages_done+1 WHERE id=$1`, [jobId])
    }
  })
  if (!vuesOk) return

  // [7] Jointure nomenclature ↔ vues
  try {
    await pool.query(`UPDATE job SET phase='jointure' WHERE id=$1`, [jobId])
    const form = new FormData()
    form.append('catalogue_id', String(catalogueId))
    const res = await fetch(`${OCR_URL}/ocr/jointure`, { method: 'POST', body: form })
    const result = await res.json()
    jobBus.emit(`job:${jobId}`, { type: 'jointure_done', ...result })
  } catch (e) {
    console.error(`Job ${jobId} jointure error:`, e.message)
  }

  await pool.query(
    `UPDATE job SET status='done', phase='done', finished_at=NOW() WHERE id=$1`,
    [jobId]
  )
  jobBus.emit(`job:${jobId}`, { type: 'done', catalogue_id: catalogueId })
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


// POST /api/import/pages — ajoute des pages à un catalogue existant
router.post('/pages', upload.single('file'), async (req, res) => {
  const { catalogue_id } = req.body
  if (!req.file) return res.status(400).json({ error: 'No file' })
  if (!catalogue_id) return res.status(400).json({ error: 'catalogue_id requis' })

  const { rows: catRows } = await pool.query('SELECT id FROM catalogue WHERE id=$1', [catalogue_id])
  if (!catRows[0]) return res.status(404).json({ error: 'Catalogue introuvable' })

  const catalogueId = parseInt(catalogue_id)

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
