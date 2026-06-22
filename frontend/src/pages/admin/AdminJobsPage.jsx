import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Upload, Eye, Wrench, Bot, RefreshCw, CheckCircle, XCircle, Loader, Cpu, FileImage } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || ''

const STATUS_CLASS = {
  refs_done:    'or-status-refs_done',
  parse_running:'or-status-running',
  done:         'or-status-done',
  ocr_running:  'or-status-running',
  pending:      'or-status-pending',
  error:        'or-status-error',
}

function PageGrid({ pages, total }) {
  if (!total) return null
  const cells = Array.from({ length: total }, (_, i) => pages[i + 1] ?? { status: 'pending' })

  return (
    <div className="or-page-grid" style={{ marginTop: '1rem' }}>
      {cells.map((cell, i) => (
        <div key={i + 1} className={`or-page-cell ${STATUS_CLASS[cell.status] ?? 'or-status-pending'}`}>
          {cell.thumb
            ? <img src={`${API}${cell.thumb}`} alt={`p${i + 1}`} />
            : <div className="or-page-cell-num">{i + 1}</div>
          }
        </div>
      ))}
    </div>
  )
}

function JobCard({ jobId }) {
  const [job, setJob] = useState(null)
  const [pages, setPages] = useState({})
  const [parseLaunching, setParseLaunching] = useState(false)
  const [parseProgress, setParseProgress] = useState({ done: 0, total: 0 })

  const launchParse = () => {
    setParseLaunching(true)
    fetch(`/api/import/${jobId}/parse`, { method: 'POST' })
      .then(r => r.json())
      .then(() => {
        setJob(j => j ? { ...j, status: 'running', phase: 'parse', pages_done: 0 } : j)
        setParseProgress({ done: 0, total: job?.pages_total ?? 0 })
      })
      .catch(() => {})
      .finally(() => setParseLaunching(false))
  }

  const loadPages = (catalogueId) => {
    fetch(`/api/catalogues/${catalogueId}/pages`)
      .then(r => r.json())
      .then(ps => {
        const map = {}
        ps.forEach(p => {
          const ps = p.process_status
          const status = ps === 'ocr_done' ? 'refs_done'
            : ps === 'detected' ? 'done'
            : ps === 'deskewed' ? 'ocr_running'
            : p.status ?? 'pending'
          map[p.numero] = { status, thumb: p.thumb }
        })
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
          setJob(j => j ? { ...j, phase: event.phase, converted: event.converted, pages_done: event.pages_done, pages_total: event.pages_total, status: event.status } : j)
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

    const esOcr = new EventSource(`/api/import/${jobId}/stream`)
    esOcr.onmessage = e => {
      try {
        const event = JSON.parse(e.data)
        if (event.type === 'page_start')       setPages(prev => ({ ...prev, [event.page_num]: { ...prev[event.page_num], status: 'ocr_running' } }))
        else if (event.type === 'page_done')   setPages(prev => ({ ...prev, [event.page_num]: { ...prev[event.page_num], status: 'done' } }))
        else if (event.type === 'parse_start') setPages(prev => ({ ...prev, [event.page_num]: { ...prev[event.page_num], status: 'parse_running' } }))
        else if (event.type === 'parse_done') {
          setPages(prev => ({ ...prev, [event.page_num]: { ...prev[event.page_num], status: 'refs_done' } }))
          setParseProgress(p => ({ ...p, done: p.done + 1 }))
        } else if (event.type === 'parse_start_all') {
          setJob(j => j ? { ...j, status: 'running', phase: 'parse' } : j)
          setParseProgress({ done: 0, total: job?.pages_total ?? 0 })
        } else if (event.type === 'page_created') {
          setPages(prev => ({ ...prev, [event.page]: { status: 'pending', thumb: event.thumb ?? null } }))
          setJob(j => j ? { ...j, converted: (j.converted ?? 0) + 1 } : j)
        }
      } catch (_) {}
    }
    esOcr.onerror = () => esOcr.close()
    es.onerror = () => es.close()
    return () => { es.close(); esOcr.close(); clearInterval(pollTimer) }
  }, [jobId])

  if (!job) return (
    <div className="or-box" style={{ marginBottom: '1rem' }}>
      <p className="or-muted" style={{ fontSize: '.85rem' }}>Chargement…</p>
    </div>
  )

  const isDone     = job.status === 'done'
  const isError    = job.status === 'error'
  const isRunning  = job.status === 'running'
  const isConverting = isRunning && (job.phase === 'splitting' || job.phase === 'splitting_done')
  const isOcr      = isRunning && job.phase === 'ocr'
  const isParse    = isRunning && job.phase === 'parse'
  const isParseDone = isDone && job.phase === 'parse'
  const canLaunchParse = (isDone && job.phase !== 'parse') || isError
  const parseDone  = parseProgress.done
  const parseTotal = parseProgress.total || job.pages_total || 0

  const statusBadge = () => {
    if (isConverting) return <span className="or-badge or-badge-yellow"><FileImage size={11} /> Conversion PDF</span>
    if (isOcr)        return <span className="or-badge or-badge-blue"><Cpu size={11} /> OCR {job.pages_done}/{job.pages_total}</span>
    if (isParse)      return <span className="or-badge or-badge-purple"><Bot size={11} /> IA {parseDone}/{parseTotal}</span>
    if (isParseDone)  return <span className="or-badge or-badge-green"><CheckCircle size={11} /> IA terminée</span>
    if (isDone)       return <span className="or-badge or-badge-green"><CheckCircle size={11} /> {job.pages_done} pages</span>
    if (isError)      return <span className="or-badge or-badge-red"><XCircle size={11} /> Erreur</span>
    return null
  }

  return (
    <div className="or-box" style={{ marginBottom: '1rem' }}>
      {/* Header */}
      <div className="or-flex" style={{ marginBottom: '.75rem' }}>
        <div>
          <p style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--text)', marginBottom: '.15rem' }}>{job.catalogue_name}</p>
          <p style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>
            {job.marque} · Job #{job.id} · {new Date(job.started_at).toLocaleTimeString()}
          </p>
        </div>
        <div className="or-spacer" />
        {statusBadge()}
      </div>

      {/* Progress: conversion */}
      {job.pages_total && (isConverting || isOcr || isDone) && (
        <div className="or-progress-wrap">
          <div className="or-progress-label">
            <span>Conversion PDF → images</span>
            <span>{isDone || isOcr ? job.pages_total : (job.converted ?? 0)}/{job.pages_total}</span>
          </div>
          <progress className={`or-progress ${isDone || isOcr ? 'is-success' : ''}`}
            value={isDone || isOcr ? job.pages_total : (job.converted ?? 0)}
            max={job.pages_total} />
        </div>
      )}
      {isConverting && !job.pages_total && (
        <div className="or-progress-wrap">
          <span style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>Conversion PDF → images…</span>
          <progress className="or-progress or-progress-indeterminate" />
        </div>
      )}

      {/* Progress: OCR */}
      {job.pages_total && (isOcr || isDone) && (
        <div className="or-progress-wrap">
          <div className="or-progress-label">
            <span>OCR Tesseract</span>
            <span>{job.pages_done}/{job.pages_total} pages</span>
          </div>
          <progress className={`or-progress ${isDone ? 'is-success' : ''}`}
            value={job.pages_done} max={job.pages_total} />
        </div>
      )}

      {isError && <p style={{ color: '#b91c1c', fontSize: '.8rem', marginBottom: '.5rem' }}>{job.error}</p>}

      {/* Progress: IA parse */}
      {(isParse || isParseDone) && parseTotal > 0 && (
        <div className="or-progress-wrap">
          <div className="or-progress-label">
            <span>Extraction IA (qwen2.5:7b)</span>
            <span>{parseDone}/{parseTotal} pages</span>
          </div>
          <progress className={`or-progress ${isParseDone ? 'is-success' : 'is-warning'}`}
            value={parseDone} max={parseTotal} />
        </div>
      )}

      <PageGrid pages={pages} total={job.pages_total} />

      {/* Actions */}
      {(isDone || isError) && (
        <div className="or-flex or-gap-2" style={{ marginTop: '1rem', flexWrap: 'wrap' }}>
          <Link to={`/catalogue/${job.catalogue_id}`} className="or-btn or-btn-secondary or-btn-sm">
            <Eye size={13} /> Voir le catalogue
          </Link>
          <Link to={`/admin/catalogue/${job.catalogue_id}`} className="or-btn or-btn-primary or-btn-sm">
            <Wrench size={13} /> Corriger les données OCR
          </Link>
          {canLaunchParse && (
            <button className={`or-btn or-btn-sm${parseLaunching ? ' is-loading' : ''}`}
              style={{ background: '#7c3aed', color: '#fff', borderColor: '#7c3aed' }}
              onClick={launchParse} disabled={parseLaunching}>
              <Bot size={13} /> Lancer l'extraction IA
            </button>
          )}
          {isParseDone && (
            <button className={`or-btn or-btn-secondary or-btn-sm${parseLaunching ? ' is-loading' : ''}`}
              style={{ color: '#7c3aed', borderColor: '#c4b5fd' }}
              onClick={launchParse} disabled={parseLaunching}>
              <RefreshCw size={13} /> Relancer l'extraction IA
            </button>
          )}
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

  if (loading) return <progress className="or-progress" />

  return (
    <div style={{ maxWidth: 820 }}>
      <div className="or-page-header">
        <div>
          <h1 className="or-page-title">Travaux d'import</h1>
          <p className="or-page-subtitle">{jobIds.length} job{jobIds.length !== 1 ? 's' : ''}</p>
        </div>
        <Link to="/admin/import" className="or-btn or-btn-primary or-btn-sm">
          <Upload size={14} /> Nouvel import
        </Link>
      </div>

      {jobIds.length === 0 ? (
        <div className="or-alert or-alert-info">
          Aucun import. <Link to="/admin/import" style={{ color: 'var(--brand)', fontWeight: 600 }}>Lancer un import</Link>.
        </div>
      ) : (
        jobIds.map(id => <JobCard key={id} jobId={id} />)
      )}
    </div>
  )
}
