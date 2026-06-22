import { useEffect, useState } from 'react'
import { ExternalLink, ToggleLeft, ToggleRight, Search } from 'lucide-react'
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

  if (loading) return <progress className="or-progress" />

  return (
    <div>
      <div className="or-page-header">
        <div>
          <h1 className="or-page-title">Sources de scraping</h1>
          <p className="or-page-subtitle">{sources.filter(s => s.actif).length} sources actives sur {sources.length}</p>
        </div>
      </div>

      <div className="or-box" style={{ marginBottom: '1.5rem', maxWidth: 420 }}>
        <p className="or-section-title">Tester une référence</p>
        <div className="or-field-addons">
          <input className="or-input" value={testRef} onChange={e => setTestRef(e.target.value)} placeholder="Référence de test" />
          <a className="or-btn or-btn-dark" href={`/ref/${encodeURIComponent(testRef)}`} target="_blank" rel="noreferrer">
            <Search size={14} /> Tester
          </a>
        </div>
      </div>

      <div className="or-box" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="or-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Nom</th>
              <th>Méthode</th>
              <th>Origine</th>
              <th>Devise</th>
              <th>TVA incluse</th>
              <th>Marques</th>
              <th>Statut</th>
            </tr>
          </thead>
          <tbody>
            {sources.map(s => (
              <tr key={s.id}>
                <td><span className="or-mono">{s.id}</span></td>
                <td>
                  <a href={s.url} target="_blank" rel="noreferrer" className="or-flex or-gap-1" style={{ color: 'var(--brand)', textDecoration: 'none' }}>
                    {s.name} <ExternalLink size={11} />
                  </a>
                </td>
                <td><span className="or-badge or-badge-neutral">{s.method}</span></td>
                <td className="or-muted" style={{ fontSize: '.8rem' }}>{s.origine}</td>
                <td>{s.devise}</td>
                <td className="or-muted">{s.inc_vat ? '✓' : '–'}</td>
                <td className="or-muted" style={{ fontSize: '.8rem' }}>{(s.marques ?? []).join(', ')}</td>
                <td>
                  <button
                    className={`or-btn or-btn-sm ${s.actif ? 'or-btn-success' : 'or-btn-secondary'}`}
                    onClick={() => toggle(s)}
                    style={{ gap: '.3rem' }}
                  >
                    {s.actif ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                    {s.actif ? 'Actif' : 'Inactif'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
