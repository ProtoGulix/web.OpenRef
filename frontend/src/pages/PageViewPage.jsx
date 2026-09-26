import React, { useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ChevronRight, Pencil, Search } from 'lucide-react'
import PageViewer from '../components/PageViewer'
import PricePanel from '../components/PricePanel'
import { api } from '../api/client'

export default function PageViewPage() {
  const { id } = useParams()
  const [page, setPage] = useState(null)
  const [refs, setRefs] = useState([])
  const [refsVues, setRefsVues] = useState([])
  const [selectedIds, setSelectedIds] = useState(new Set())   // lignes en surbrillance
  const [selectedRepere, setSelectedRepere] = useState(null)  // repère en surbrillance
  const [hoveredNomencId, setHoveredNomencId] = useState(null)
  const [hoveredRepere, setHoveredRepere] = useState(null)
  const [priceRef, setPriceRef] = useState(null)              // ligne dont on cherche les prix
  const [loading, setLoading] = useState(true)
  const rowRefs = useRef({})

  useEffect(() => {
    api.getPage(id).then(pg => {
      setPage(pg)
      const refsPromise = pg.has_nomenclature ? api.getPageNomenclature(id) : api.getPageRefs(id)
      return Promise.all([refsPromise, api.getPageRefsVues(id)])
    })
      .then(([rs, rv]) => { setRefs(rs); setRefsVues(rv) })
      .finally(() => setLoading(false))
  }, [id])

  // Clic repère → surbrillance de toutes les lignes liées, scroll vers la première
  const handleRepereClick = (repere) => {
    setSelectedRepere(repere)
    const ids = new Set(repere.liaisons?.map(l => l.nomenclature_id) ?? [])
    setSelectedIds(ids)
    setPriceRef(null)
    const firstId = repere.liaisons?.[0]?.nomenclature_id
    if (firstId) rowRefs.current[firstId]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  // Clic ligne → surbrillance de cette ligne + son repère
  const handleRowClick = (ref) => {
    setSelectedIds(new Set([ref.id]))
    const repere = refsVues.find(r => r.liaisons?.some(l => l.nomenclature_id === ref.id))
    setSelectedRepere(repere ?? null)
    if (priceRef?.id === ref.id) setPriceRef(null) // toggle prix si déjà ouvert sur cette ligne
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
            onRepereHover={r => setHoveredRepere(r ?? null)}
            selectedNomencId={selectedIds.size === 1 ? [...selectedIds][0] : null}
            selectedRepereId={selectedRepere?.id ?? null}
            hoveredNomencIds={hoveredRepere ? new Set(hoveredRepere.liaisons?.map(l => l.nomenclature_id) ?? []) : hoveredNomencId ? new Set([hoveredNomencId]) : null}
            hoveredRepereId={hoveredNomencId ? refsVues.find(rv => rv.liaisons?.some(l => l.nomenclature_id === hoveredNomencId))?.id ?? null : hoveredRepere?.id ?? null}
            schemaOnly
          />
        </div>

        <div className="column is-half">
          <h2 style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '.75rem', color: 'var(--text)' }}>
            {page.titre || `Page ${page.numero}`}
          </h2>

          <div className="or-box" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="or-table">
              <thead>
                <tr><th>#</th><th>Référence</th><th>Description</th><th>Qté</th><th>Remarques</th><th></th></tr>
              </thead>
              <tbody>
                {refs.map(r => {
                  const isHighlighted = selectedIds.has(r.id)
                  const isHovered = hoveredNomencId === r.id || (hoveredRepere?.liaisons?.some(l => l.nomenclature_id === r.id) ?? false)
                  const isPriceOpen = priceRef?.id === r.id
                  const linkedRepere = refsVues.find(rv => rv.liaisons?.some(l => l.nomenclature_id === r.id))
                  const repereNum = linkedRepere?.part_number ?? null
                  return (
                    <React.Fragment key={r.id}>
                      <tr
                        ref={el => { rowRefs.current[r.id] = el }}
                        onClick={() => handleRowClick(r)}
                        onMouseEnter={() => setHoveredNomencId(r.id)}
                        onMouseLeave={() => setHoveredNomencId(null)}
                        style={{
                          cursor: 'pointer',
                          background: isHighlighted ? 'var(--brand-light)' : isHovered ? 'rgba(139,92,246,0.07)' : undefined,
                          outline: isHighlighted ? '2px solid #8b5cf6' : isHovered ? '1px solid rgba(139,92,246,0.3)' : undefined,
                          transition: 'background 0.1s',
                        }}
                      >
                        <td style={{ fontSize: '.8rem' }}>
                          {repereNum != null
                            ? <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: isHighlighted ? '#6d28d9' : isHovered ? '#7c3aed' : '#8b5cf6', color: '#fff', borderRadius: '50%', width: 20, height: 20, fontSize: 10, fontWeight: 'bold', transition: 'background 0.1s' }}>{repereNum}</span>
                            : <span className="or-muted">{r.ref_no ?? r.plate_ref}</span>
                          }
                        </td>
                        <td><span className="or-mono">{r.part_number}</span></td>
                        <td style={{ fontSize: '.85rem' }}>{r.description}</td>
                        <td className="or-muted">{r.qty}</td>
                        <td className="or-muted" style={{ fontSize: '.8rem' }}>{r.remarks}</td>
                        <td onClick={e => e.stopPropagation()}>
                          <button
                            title="Chercher les prix"
                            onClick={() => setPriceRef(isPriceOpen ? null : r)}
                            className="or-btn or-btn-ghost or-btn-sm or-btn-icon-only"
                            style={{ opacity: isPriceOpen ? 1 : 0.45, color: isPriceOpen ? '#8b5cf6' : undefined }}
                          >
                            <Search size={13} />
                          </button>
                        </td>
                      </tr>
                      {isPriceOpen && (
                        <tr style={{ background: 'var(--brand-light)' }}>
                          <td colSpan={6} style={{ padding: '0.75rem 1rem' }}>
                            <PricePanel partNumber={r.part_number} marque="landrover" />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
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
