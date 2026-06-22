import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Tag } from 'lucide-react'
import SearchBar from '../components/SearchBar'
import { api } from '../api/client'

export default function SearchPage() {
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const search = async (q, marque) => {
    setLoading(true)
    setError(null)
    try {
      setResults(await api.search(q, marque))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <div className="or-page-header">
        <div>
          <h1 className="or-page-title">Recherche de pièces</h1>
          <p className="or-page-subtitle">Référence, description ou désignation</p>
        </div>
      </div>

      <SearchBar onSearch={search} loading={loading} />

      {error && (
        <div className="or-alert or-alert-error" style={{ marginTop: '1rem' }}>
          {error}
        </div>
      )}

      {results !== null && (
        <div style={{ marginTop: '1.5rem' }}>
          <p className="or-muted" style={{ fontSize: '.85rem', marginBottom: '.75rem' }}>
            {results.length} résultat{results.length !== 1 ? 's' : ''}
          </p>
          {results.length === 0
            ? <p className="or-muted">Aucun résultat pour cette recherche.</p>
            : (
              <div className="or-box" style={{ padding: 0, overflow: 'hidden' }}>
                <table className="or-table">
                  <thead>
                    <tr>
                      <th>Référence</th>
                      <th>Description</th>
                      <th>Marque / Modèle</th>
                      <th>Catalogue</th>
                      <th>Page</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map(r => (
                      <tr key={r.id}>
                        <td><span className="or-mono">{r.part_number}</span></td>
                        <td>{r.description}</td>
                        <td className="or-muted" style={{ fontSize: '.8rem' }}>{r.marque}{r.modele ? ` — ${r.modele}` : ''}</td>
                        <td><Link to={`/catalogue/${r.catalogue_id}`} style={{ color: 'var(--brand)' }}>{r.catalogue_name}</Link></td>
                        <td><Link to={`/page/${r.page_id}`} style={{ color: 'var(--brand)' }}>P.{r.page_numero}</Link></td>
                        <td>
                          <Link to={`/ref/${encodeURIComponent(r.part_number)}`} className="or-btn or-btn-secondary or-btn-sm">
                            <Tag size={12} /> Prix
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      )}
    </div>
  )
}
