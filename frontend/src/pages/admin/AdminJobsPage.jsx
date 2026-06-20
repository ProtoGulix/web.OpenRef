import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

const API = import.meta.env.VITE_API_URL || ''

function PageGrid({ pages, total }) {
  if (!total) return null

  const cells = Array.from({ length: total }, (_, i) => {
    const pn = i + 1
    return pages[pn] ?? { status: 'pending' }
  })

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))',
      gap: '4px',
      maxHeight: '320px',
      overflowY: 'auto',
      marginTop: '8px',
    }}>
      {cells.map((cell, i) => {
        const pn = i + 1
        const { status, thumb } = cell

        const borderColor = status === 'done' ? '#48c78e'
          : status === 'ocr_running' ? '#3e8ed0'
          : status === 'pending' ? '#ffe08a'
          : '#dbdbdb'

        return (
          <div key={pn} style={{
            position: 'relative',
            width: '100%',
            paddingBottom: '100%',
            border: `2px solid ${borderColor}`,
            borderRadius: '4px',
            overflow: 'hidden',
            background: '#f5f5f5',
            transition: 'border-color 0.3s',
          }}>
            {thumb ? (
              <img
                src={`${API}${thumb}`}
                alt={`page ${pn}`}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '10px', color: '#aaa',
              }}>
                {pn}
              </div>
            )}

            {/* Badge état */}
            <div style={{
              position: 'absolute', bottom: '2px', right: '2px',
              fontSize: '10px', lineHeight: 1,
              opacity: status === 'pending' ? 0.4 : 1,
            }}>
              {status === 'done' ? '✅' : status === 'ocr_running' ? '🔄' : '⏳'}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function JobCard({ jobId }) {
  const [job, setJob] = useState(null)
  const [pages, setPages] = useState({})  // pageNum → { status, thumb }

  const loadPages = (catalogueId) => {
    fetch(`/api/catalogues/${catalogueId}/pages`)
      .then(r => r.json())
      .then(ps => {
        const map = {}
        ps.forEach(p => { map[p.numero] = { status: p.status ?? 'done', thumb: p.thumb } })
        setPages(map)
      })
      .catch(() => {})
  }

  useEffect(() => {
    let pollTimer = null

    fetch(`/api/import/${jobId}/status`)
      .then(r => r.json())
      .then(data => {
        setJob(data)
        if (data.catalogue_id) {
          loadPages(data.catalogue_id)
          // Polling toutes les 5s pendant que le job tourne
          if (data.status === 'running') {
            pollTimer = setInterval(() => loadPages(data.catalogue_id), 5000)
          }
        }
      })
      .catch(() => {})

    const es = new EventSource(`/api/import/${jobId}/progress`)

    es.onmessage = e => {
      try {
        const event = JSON.parse(e.data)

        if (event.type === 'progress') {
          setJob(j => j ? {
            ...j,
            phase: event.phase,
            converted: event.converted,
            pages_done: event.pages_done,
            pages_total: event.pages_total,
            status: event.status,
          } : j)
        } else if (event.type === 'done') {
          setJob(j => j ? { ...j, status: 'done', phase: 'ocr', pages_done: event.pages_done, pages_total: event.pages_total } : j)
          clearInterval(pollTimer)
          es.close()
        } else if (event.type === 'error') {
          setJob(j => j ? { ...j, status: 'error', error: event.error } : j)
          clearInterval(pollTimer)
          es.close()
        }
      } catch (_) {}
    }

    // SSE direct — mise à jour optimiste page par page sans attendre le poll
    const esOcr = new EventSource(`/api/import/${jobId}/stream`)
    esOcr.onmessage = e => {
      try {
        const event = JSON.parse(e.data)
        if (event.type === 'page_start') {
          setPages(prev => ({ ...prev, [event.page_num]: { ...prev[event.page_num], status: 'ocr_running' } }))
        } else if (event.type === 'page_done') {
          setPages(prev => ({ ...prev, [event.page_num]: { ...prev[event.page_num], status: 'done' } }))
        } else if (event.type === 'page_created') {
          setPages(prev => ({ ...prev, [event.page]: { status: event.thumb ? 'pending' : 'pending', thumb: event.thumb ?? null } }))
          setJob(j => j ? { ...j, converted: (j.converted ?? 0) + 1 } : j)
        }
      } catch (_) {}
    }
    esOcr.onerror = () => esOcr.close()

    es.onerror = () => es.close()
    return () => { es.close(); esOcr.close(); clearInterval(pollTimer) }
  }, [jobId])

  if (!job) return (
    <div className="box">
      <p className="has-text-grey">Chargement…</p>
    </div>
  )

  const isDone = job.status === 'done'
  const isError = job.status === 'error'
  const isRunning = job.status === 'running'
  const isConverting = isRunning && (job.phase === 'splitting' || job.phase === 'splitting_done')
  const isOcr = isRunning && job.phase === 'ocr'

  return (
    <div className="box">
      {/* En-tête */}
      <div className="level mb-2">
        <div className="level-left">
          <div>
            <p className="has-text-weight-bold is-size-5">{job.catalogue_name}</p>
            <p className="is-size-7 has-text-grey">
              {job.marque} — Job #{job.id} · {new Date(job.started_at).toLocaleTimeString()}
            </p>
          </div>
        </div>
        <div className="level-right">
          {isConverting && <span className="tag is-warning is-light is-medium">🔄 Conversion PDF</span>}
          {isOcr && <span className="tag is-info is-light is-medium">🔍 OCR {job.pages_done}/{job.pages_total}</span>}
          {isDone && <span className="tag is-success is-medium">✅ {job.pages_done} pages</span>}
          {isError && <span className="tag is-danger is-medium">❌ Erreur</span>}
        </div>
      </div>

      {/* Barre conversion */}
      {job.pages_total && (isConverting || isOcr || isDone) && (
        <div className="mb-1">
          <div className="is-flex is-justify-content-space-between" style={{ fontSize: '11px', color: '#888' }}>
            <span>Conversion PDF → images</span>
            <span>{isDone || isOcr ? job.pages_total : (job.converted ?? 0)}/{job.pages_total}</span>
          </div>
          <progress
            className={`progress mb-0 ${isDone || isOcr ? 'is-success' : 'is-warning'}`}
            style={{ height: '6px' }}
            value={isDone || isOcr ? job.pages_total : (job.converted ?? 0)}
            max={job.pages_total}
          />
        </div>
      )}
      {isConverting && !job.pages_total && (
        <div className="mb-1">
          <span style={{ fontSize: '11px', color: '#888' }}>Conversion PDF → images…</span>
          <progress className="progress is-warning mb-0" style={{ height: '6px' }} />
        </div>
      )}

      {/* Barre OCR */}
      {job.pages_total && (isOcr || isDone) && (
        <div className="mb-2">
          <div className="is-flex is-justify-content-space-between" style={{ fontSize: '11px', color: '#888' }}>
            <span>OCR Tesseract ×4</span>
            <span>{job.pages_done}/{job.pages_total} pages</span>
          </div>
          <progress
            className={`progress mb-0 ${isDone ? 'is-success' : 'is-info'}`}
            style={{ height: '6px' }}
            value={job.pages_done}
            max={job.pages_total}
          />
        </div>
      )}

      {isError && <p className="has-text-danger is-size-7 mb-2">{job.error}</p>}

      {/* Grille pages */}
      <PageGrid pages={pages} total={job.pages_total} />

      {/* Actions */}
      {isDone && (
        <div className="buttons mt-3">
          <Link to={`/catalogue/${job.catalogue_id}`} className="button is-light is-small">
            Voir le catalogue
          </Link>
          <Link to={`/admin/catalogue/${job.catalogue_id}`} className="button is-success is-small">
            Corriger les données OCR →
          </Link>
        </div>
      )}
    </div>
  )
}

export default function AdminJobsPage() {
  const [searchParams] = useSearchParams()
  const newId = searchParams.get('id') ? parseInt(searchParams.get('id')) : null
  const [jobIds, setJobIds] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/import/all')
      .then(r => r.json())
      .then(jobs => {
        const ids = jobs.map(j => j.id)
        if (newId && !ids.includes(newId)) ids.unshift(newId)
        setJobIds(ids)
      })
      .catch(() => { if (newId) setJobIds([newId]) })
      .finally(() => setLoading(false))
  }, [newId])

  if (loading) return <progress className="progress is-info" />

  return (
    <div style={{ maxWidth: 800 }}>
      <div className="level">
        <div className="level-left">
          <h1 className="title level-item">Travaux</h1>
        </div>
        <div className="level-right">
          <Link to="/admin/import" className="button is-dark is-small level-item">+ Nouvel import</Link>
        </div>
      </div>

      {jobIds.length === 0 ? (
        <div className="notification is-light">
          Aucun import. <Link to="/admin/import">Lancer un import</Link>.
        </div>
      ) : (
        jobIds.map(id => <JobCard key={id} jobId={id} />)
      )}
    </div>
  )
}
