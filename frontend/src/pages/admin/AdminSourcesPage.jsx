import { useEffect, useState } from 'react'
import { api } from '../../api/client'

export default function AdminSourcesPage() {
  const [sources, setSources] = useState([])
  const [loading, setLoading] = useState(true)
  const [testRef, setTestRef] = useState('ERR6066')

  useEffect(() => {
    api.getSources().then(setSources).finally(() => setLoading(false))
  }, [])

  const toggle = async (source) => {
    const updated = await api.patchSource(source.id, { actif: !source.actif })
    setSources(ss => ss.map(s => s.id === updated.id ? updated : s))
  }

  if (loading) return <progress className="progress is-info" />

  return (
    <div>
      <h1 className="title">Sources de scraping</h1>

      <div className="field has-addons mb-4" style={{ maxWidth: 400 }}>
        <div className="control is-expanded">
          <input className="input" value={testRef} onChange={e => setTestRef(e.target.value)} placeholder="Référence de test" />
        </div>
        <div className="control">
          <a className="button is-dark" href={`/ref/${encodeURIComponent(testRef)}`} target="_blank" rel="noreferrer">
            Tester
          </a>
        </div>
      </div>

      <table className="table is-fullwidth is-hoverable">
        <thead>
          <tr>
            <th>ID</th>
            <th>Nom</th>
            <th>Méthode</th>
            <th>Origine</th>
            <th>Devise</th>
            <th>TVA incluse</th>
            <th>Marques</th>
            <th>Actif</th>
          </tr>
        </thead>
        <tbody>
          {sources.map(s => (
            <tr key={s.id}>
              <td><code>{s.id}</code></td>
              <td><a href={s.url} target="_blank" rel="noreferrer">{s.name}</a></td>
              <td><span className="tag is-light">{s.method}</span></td>
              <td>{s.origine}</td>
              <td>{s.devise}</td>
              <td>{s.inc_vat ? '✓' : '–'}</td>
              <td>{(s.marques ?? []).join(', ')}</td>
              <td>
                <button
                  className={`button is-small ${s.actif ? 'is-success' : 'is-light'}`}
                  onClick={() => toggle(s)}
                >
                  {s.actif ? 'Actif' : 'Inactif'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
