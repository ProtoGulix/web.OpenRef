import { useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ChevronRight, Pencil } from 'lucide-react'
import PageViewer from '../components/PageViewer'
import PricePanel from '../components/PricePanel'
import { api } from '../api/client'

export default function PageViewPage() {
  const { id } = useParams()
  const [page, setPage] = useState(null)
  const [refs, setRefs] = useState([])
  const [refsVues, setRefsVues] = useState([])
  const [selected, setSelected] = useState(null)       // ligne nomenclature sélectionnée
  const [selectedRepere, setSelectedRepere] = useState(null) // repère sélectionné
  const [loading, setLoading] = useState(true)
  const rowRefs = useRef({})  // refs vers les <tr> pour scroll

  useEffect(() => {
    api.getPage(id).then(pg => {
      setPage(pg)
      const refsPromise = pg.has_nomenclature ? api.getPageNomenclature(id) : api.getPageRefs(id)
      return Promise.all([refsPromise, api.getPageRefsVues(id)])
    })
      .then(([rs, rv]) => { setRefs(rs); setRefsVues(rv) })
      .finally(() => setLoading(false))
  }, [id])

  // Clic sur un repère → sélectionne + scroll vers la ligne nomenclature
  const handleRepereClick = (repere) => {
    setSelectedRepere(repere)
    if (repere.nomenclature_id) {
      const match = refs.find(r => r.id === repere.nomenclature_id)
      if (match) {
        setSelected(match)
        rowRefs.current[match.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }
  }

  // Clic sur une ligne → sélectionne + trouve le repère correspondant
  const handleRowClick = (ref) => {
    setSelected(ref)
    // Cherche le repère lié à cette ligne nomenclature
    const repere = refsVues.find(r => r.nomenclature_id === ref.id)
    setSelectedRepere(repere ?? null)
  }

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
        <Link
          to={`/admin/page/${id}/edit`}
          title="Éditer dans l'admin"
          style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '.3rem', fontSize: '.8rem', color: 'var(--text-muted, #888)', textDecoration: 'none' }}
        >
          <Pencil size={13} />
          Admin
        </Link>
      </div>

      <div className="columns" style={{ alignItems: 'flex-start' }}>
        <div className="column is-half" style={{ position: 'sticky', top: '72px' }}>
          <PageViewer
            page={page}
            refs={refs}
            refsVues={refsVues}
            onRefClick={handleRowClick}
            onRepereClick={handleRepereClick}
            selectedNomencId={selected?.id ?? null}
            selectedRepereId={selectedRepere?.id ?? null}
          />
        </div>

        <div className="column is-half">
          <h2 style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '.75rem', color: 'var(--text)' }}>
            {page.titre || `Page ${page.numero}`}
          </h2>

          {selected && (
            <div className="or-box" style={{ marginBottom: '1rem' }}>
              <p style={{ fontWeight: 600, marginBottom: '.25rem' }}>
                {selected.ref_no && <span className="or-muted" style={{ marginRight: '.4rem' }}>#{selected.ref_no} —</span>}
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
                {refs.map(r => {
                  const isSelected = selected?.id === r.id
                  const hasRepere = refsVues.some(rv => rv.nomenclature_id === r.id)
                  return (
                    <tr
                      key={r.id}
                      ref={el => { rowRefs.current[r.id] = el }}
                      onClick={() => handleRowClick(r)}
                      style={{
                        cursor: 'pointer',
                        background: isSelected ? 'var(--brand-light)' : undefined,
                        outline: isSelected ? '2px solid #8b5cf6' : undefined,
                      }}
                    >
                      <td style={{ fontSize: '.8rem' }}>
                        {hasRepere
                          ? <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: isSelected ? '#6d28d9' : '#8b5cf6', color: '#fff', borderRadius: '50%', width: 20, height: 20, fontSize: 10, fontWeight: 'bold' }}>{r.ref_no ?? r.plate_ref}</span>
                          : <span className="or-muted">{r.ref_no ?? r.plate_ref}</span>
                        }
                      </td>
                      <td><span className="or-mono">{r.part_number}</span></td>
                      <td style={{ fontSize: '.85rem' }}>{r.description}</td>
                      <td className="or-muted">{r.qty}</td>
                      <td className="or-muted" style={{ fontSize: '.8rem' }}>{r.remarks}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
