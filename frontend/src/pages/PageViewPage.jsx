import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import PageViewer from '../components/PageViewer'
import PricePanel from '../components/PricePanel'
import { api } from '../api/client'

export default function PageViewPage() {
  const { id } = useParams()
  const [page, setPage] = useState(null)
  const [refs, setRefs] = useState([])
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getPage(id).then(pg => {
      setPage(pg)
      const refsPromise = pg.has_nomenclature
        ? api.getPageNomenclature(id)
        : api.getPageRefs(id)
      return refsPromise
    })
      .then(rs => setRefs(rs))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <progress className="or-progress" />
  if (!page) return <p className="or-muted">Page introuvable.</p>

  return (
    <div>
      <div className="or-breadcrumb">
        <Link to="/catalogues">Catalogues</Link>
        <ChevronRight size={12} />
        <Link to={`/catalogue/${page.id_catalogue}`}>Catalogue</Link>
        <ChevronRight size={12} />
        <span>Page {page.numero}</span>
      </div>

      <div className="columns" style={{ alignItems: 'flex-start' }}>
        <div className="column is-half" style={{ position: 'sticky', top: '72px' }}>
          <PageViewer page={page} refs={refs} onRefClick={setSelected} />
        </div>

        <div className="column is-half">
          <h2 style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '.75rem', color: 'var(--text)' }}>
            {page.titre || `Page ${page.numero}`}
          </h2>

          {selected && (
            <div className="or-box" style={{ marginBottom: '1rem' }}>
              <p style={{ fontWeight: 600, marginBottom: '.25rem' }}>
                {selected.plate_ref && <span className="or-muted" style={{ marginRight: '.4rem' }}>{selected.plate_ref} —</span>}
                <span className="or-mono">{selected.part_number}</span>
              </p>
              <p style={{ fontSize: '.875rem', marginBottom: '.75rem' }}>{selected.description}</p>
              <PricePanel partNumber={selected.part_number} marque="landrover" />
            </div>
          )}

          <div className="or-box" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="or-table">
              <thead>
                <tr><th>#</th><th>Référence</th><th>Description</th><th>Qté</th><th>Remarques</th></tr>
              </thead>
              <tbody>
                {refs.map(r => (
                  <tr
                    key={r.id}
                    onClick={() => setSelected(r)}
                    style={{
                      cursor: 'pointer',
                      background: selected?.id === r.id ? 'var(--brand-light)' : undefined,
                    }}
                  >
                    <td className="or-muted" style={{ fontSize: '.8rem' }}>{r.ref_no ?? r.plate_ref}</td>
                    <td><span className="or-mono">{r.part_number}</span></td>
                    <td style={{ fontSize: '.85rem' }}>{r.description}</td>
                    <td className="or-muted">{r.qty}</td>
                    <td className="or-muted" style={{ fontSize: '.8rem' }}>{r.remarks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
