import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'

function JobRow({ catalogue }) {
  const [status, setStatus] = useState(null)

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const res = await fetch(`/api/import/${catalogue.id}/status`)
        if (res.ok) {
          const data = await res.json()
          if (!cancelled) setStatus(data)
        }
      } catch (_) {}
    }
    poll()
    const timer = setInterval(poll, 2000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [catalogue.id])

  const pct = status?.total ? Math.round((status.pages / status.total) * 100) : null

  return (
    <tr>
      <td>{catalogue.id}</td>
      <td><Link to={`/catalogue/${catalogue.id}`}>{catalogue.name}</Link></td>
      <td>{catalogue.marque}</td>
      <td>
        {status === null && <span className="tag is-light">Inconnu</span>}
        {status?.error && <span className="tag is-danger">Erreur</span>}
        {status && !status.error && status.done && <span className="tag is-success">Terminé</span>}
        {status && !status.error && !status.done && <span className="tag is-info">En cours</span>}
      </td>
      <td>
        {pct !== null ? (
          <progress className="progress is-small is-info mb-0" value={pct} max={100} style={{ minWidth: 120 }}>{pct}%</progress>
        ) : status?.done ? (
          <span className="has-text-grey is-size-7">{catalogue.nb_pages} pages</span>
        ) : '—'}
      </td>
      <td>
        {status?.done && !status?.error && (
          <Link to={`/admin/catalogue/${catalogue.id}`} className="button is-small is-info is-light">Corriger</Link>
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

  if (loading) return <progress className="progress is-info" />

  return (
    <div>
      <div className="level">
        <div className="level-left"><h1 className="title level-item">Imports</h1></div>
        <div className="level-right">
          <Link to="/admin/import" className="button is-dark level-item">Nouvel import</Link>
        </div>
      </div>

      {catalogues.length === 0 ? (
        <p className="has-text-grey">Aucun catalogue. <Link to="/admin/import">Importer</Link></p>
      ) : (
        <table className="table is-fullwidth is-hoverable">
          <thead>
            <tr><th>#</th><th>Nom</th><th>Marque</th><th>Statut</th><th>Progression</th><th></th></tr>
          </thead>
          <tbody>
            {catalogues.map(c => <JobRow key={c.id} catalogue={c} />)}
          </tbody>
        </table>
      )}
    </div>
  )
}
