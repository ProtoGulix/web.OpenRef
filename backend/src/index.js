import 'dotenv/config'
import express from 'express'
import cors from 'cors'

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection (ignored):', err?.message ?? err)
})

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception (ignored):', err?.message ?? err)
})

import cataloguesRouter from './routes/catalogues.js'
import pagesRouter from './routes/pages.js'
import referencesRouter from './routes/references.js'
import sourcesRouter from './routes/sources.js'
import importRouter from './routes/import.js'
import prixRouter from './routes/prix.js'
import searchRouter from './routes/search.js'

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json())

// Servir les fichiers stockés (images pages)
app.use('/storage', express.static('../storage'))

app.use('/api/catalogues', cataloguesRouter)
app.use('/api', pagesRouter)
app.use('/api', referencesRouter)
app.use('/api/sources', sourcesRouter)
app.use('/api/import', importRouter)
app.use('/api/prix', prixRouter)
app.use('/api/search', searchRouter)

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))

app.listen(PORT, '0.0.0.0', () => console.log(`Backend listening on http://0.0.0.0:${PORT}`))
