import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Upload, Wrench } from 'lucide-react'
import { api } from '../../api/client'

function JobRow({ catalogue }) {
  const [status, setStatus] = useState(null)

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const res = await fetch(`/api/import/${catalogue.id}/status`)
        if (res.ok && !cancelled) setStatus(await res.json())
      } catch (_) {}
    }
    poll()
    const timer = setInterval(poll, 2000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [catalogue.id])

  const pct = status?.total ? Math.round((status.pages / status.total) * 100) : null

  const badge = () => {
    if (!status) return <span className="or-badge or-badge-neutral">Inconnu</span>
    if (status.error) return <span className="or-badge or-badge-red">Erreur</span>
    if (status.done) return <span className="or-badge or-badge-green">Terminé</span>
    return <span className="or-badge or-badge-blue">En cours</span>
  }

  return (
    <tr>
      <td className="or-muted" style={{ fontSize: '.8rem' }}>{catalogue.id}</td>
      <td><Link to={`/catalogue/${catalogue.id}`} style={{ color: 'var(--brand)' }}>{catalogue.name}</Link></td>
      <td className="or-muted" style={{ fontSize: '.8rem' }}>{catalogue.marque}</td>
      <td>{badge()}</td>
      <td style={{ minWidth: 140 }}>
        {pct !== null
          ? <progress className="or-progress" value={pct} max={100} style={{ marginBottom: 0 }} />
          : status?.done
            ? <span className="or-muted" style={{ fontSize: '.8rem' }}>{catalogue.nb_pages} pages</span>
            : '—'}
      </td>
      <td>
        {status?.done && !status?.error && (
          <Link to={`/admin/catalogue/${catalogue.id}`} className="or-btn or-btn-secondary or-btn-sm">
            <Wrench size={12} /> Corriger
          </Link>
        )}
      </td>
    </tr>
  )
}

export default function AdminImportsPage() {
  const [catalogues, setCatalogues] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getCatalogues().then(setCatalogues).finally(() => setLoading(false))
    const timer = setInterval(() => api.getCatalogues().then(setCatalogues), 5000)
    return () => clearInterval(timer)
  }, [])

  if (loading) return <progress className="or-progress" />

  return (
    <div>
      <div className="or-page-header">
        <h1 className="or-page-title">Imports</h1>
        <Link to="/admin/import" className="or-btn or-btn-primary or-btn-sm">
          <Upload size={14} /> Nouvel import
        </Link>
      </div>

      {catalogues.length === 0 ? (
        <div className="or-alert or-alert-info">
          Aucun catalogue. <Link to="/admin/import" style={{ color: 'var(--brand)', fontWeight: 600 }}>Importer</Link>
        </div>
      ) : (
        <div className="or-box" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="or-table">
            <thead>
              <tr><th>#</th><th>Nom</th><th>Marque</th><th>Statut</th><th>Progression</th><th></th></tr>
            </thead>
            <tbody>
              {catalogues.map(c => <JobRow key={c.id} catalogue={c} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
