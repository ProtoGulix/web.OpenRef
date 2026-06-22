import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ChevronRight, Tag } from 'lucide-react'
import PricePanel from '../components/PricePanel'
import { api } from '../api/client'

export default function RefPage() {
  const { partNumber } = useParams()
  const decoded = decodeURIComponent(partNumber)
  const [refs, setRefs] = useState([])
  const [marque, setMarque] = useState('landrover')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.search(decoded).then(rows => {
      setRefs(rows)
      if (rows[0]?.marque) setMarque(rows[0].marque)
    }).finally(() => setLoading(false))
  }, [decoded])

  if (loading) return <progress className="or-progress" />

  return (
    <div style={{ maxWidth: 900 }}>
      <div className="or-breadcrumb">
        <Link to="/">Recherche</Link>
        <ChevronRight size={12} />
        <span><span className="or-mono">{decoded}</span></span>
      </div>

      <div className="or-page-header">
        <div>
          <h1 className="or-page-title"><span className="or-mono" style={{ fontSize: '1.4rem' }}>{decoded}</span></h1>
          {refs[0] && <p className="or-page-subtitle">{refs[0].description}</p>}
        </div>
        <span className="or-badge or-badge-blue"><Tag size={11} /> {marque}</span>
      </div>

      <div className="or-box" style={{ marginBottom: '1.25rem' }}>
        <p className="or-section-title">Prix en temps réel</p>
        <PricePanel partNumber={decoded} marque={marque} />
      </div>

      {refs.length > 0 && (
        <div className="or-box" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '.75rem 1rem .5rem', borderBottom: '1px solid var(--border)' }}>
            <p className="or-section-title" style={{ marginBottom: 0 }}>Pages source</p>
          </div>
          <table className="or-table">
            <thead>
              <tr><th>Catalogue</th><th>Page</th><th>Description</th></tr>
            </thead>
            <tbody>
              {refs.map(r => (
                <tr key={r.id}>
                  <td style={{ fontSize: '.8rem' }}>{r.catalogue_name} <span className="or-muted">({r.marque})</span></td>
                  <td>
                    <Link to={`/page/${r.page_id}`} style={{ color: 'var(--brand)' }}>P.{r.page_numero}</Link>
                  </td>
                  <td style={{ fontSize: '.85rem' }}>{r.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
