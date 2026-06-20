import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../../api/client'

export default function AdminCataloguePage() {
  const { id } = useParams()
  const [catalogue, setCatalogue] = useState(null)
  const [pages, setPages] = useState([])
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([api.getCatalogue(id), api.getCataloguePages(id)])
      .then(([cat, pgs]) => { setCatalogue(cat); setPages(pgs) })
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <progress className="progress is-info" />

  const filtered = pages.filter(p => {
    if (filter === 'uncorrected') return p.nb_refs > 0 && p.nb_corriges < p.nb_refs
    if (filter === 'corrected') return p.nb_refs > 0 && p.nb_corriges === p.nb_refs
    return true
  })

  const totalRefs = pages.reduce((s, p) => s + p.nb_refs, 0)
  const totalCorr = pages.reduce((s, p) => s + p.nb_corriges, 0)
  const pct = totalRefs > 0 ? Math.round((totalCorr / totalRefs) * 100) : 0

  return (
    <div>
      <nav className="breadcrumb"><ul>
        <li><Link to="/catalogues">Catalogues</Link></li>
        <li className="is-active"><a>Admin — {catalogue?.name}</a></li>
      </ul></nav>

      <h1 className="title">Correction OCR — {catalogue?.name}</h1>

      <div className="box mb-4">
        <p className="mb-2">{totalCorr} / {totalRefs} références corrigées ({pct}%)</p>
        <progress className="progress is-success" value={pct} max={100}>{pct}%</progress>
      </div>

      <div className="tabs mb-4">
        <ul>
          {[['all', 'Toutes'], ['uncorrected', 'À corriger'], ['corrected', 'Corrigées']].map(([v, l]) => (
            <li key={v} className={filter === v ? 'is-active' : ''}>
              <a onClick={() => setFilter(v)}>{l}</a>
            </li>
          ))}
        </ul>
      </div>

      <table className="table is-fullwidth is-hoverable">
        <thead>
          <tr><th>Page</th><th>Titre</th><th>Type</th><th>Refs</th><th>Corrigées</th><th></th></tr>
        </thead>
        <tbody>
          {filtered.map(p => (
            <tr key={p.id}>
              <td>{p.numero}</td>
              <td>{p.titre}</td>
              <td><span className="tag is-light">{p.type}</span></td>
              <td>{p.nb_refs}</td>
              <td>
                <span className={p.nb_corriges === p.nb_refs && p.nb_refs > 0 ? 'has-text-success' : 'has-text-warning'}>
                  {p.nb_corriges}
                </span>
              </td>
              <td>
                <Link to={`/admin/page/${p.id}/edit`} className="button is-small is-info is-light">
                  Éditer
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
