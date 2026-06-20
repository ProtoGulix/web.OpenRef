import { useState } from 'react'
import { Link } from 'react-router-dom'
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
      const rows = await api.search(q, marque)
      setResults(rows)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <h1 className="title">Recherche de pièces</h1>
      <SearchBar onSearch={search} loading={loading} />

      {error && <div className="notification is-danger mt-4">{error}</div>}

      {results !== null && (
        <div className="mt-4">
          <p className="has-text-grey mb-3">{results.length} résultat{results.length !== 1 ? 's' : ''}</p>
          {results.length === 0
            ? <p className="has-text-grey">Aucun résultat.</p>
            : (
              <table className="table is-fullwidth is-hoverable">
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
                      <td><code>{r.part_number}</code></td>
                      <td>{r.description}</td>
                      <td>{r.marque} {r.modele && `— ${r.modele}`}</td>
                      <td>
                        <Link to={`/catalogue/${r.catalogue_id}`}>{r.catalogue_name}</Link>
                      </td>
                      <td>
                        <Link to={`/page/${r.page_id}`}>P.{r.page_numero}</Link>
                      </td>
                      <td>
                        <Link to={`/ref/${encodeURIComponent(r.part_number)}`} className="button is-small is-info is-light">
                          Prix
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      )}
    </div>
  )
}
