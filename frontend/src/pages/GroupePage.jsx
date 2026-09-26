import React, { useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ChevronRight, Search, Settings } from 'lucide-react'
import PageViewer from '../components/PageViewer'
import PricePanel from '../components/PricePanel'
import { api } from '../api/client'

// Regroupe les nomenclatures par repère (ref_no), en gardant l'ordre naturel du premier repère rencontré.
// Les lignes sans repère lié forment chacune leur propre groupe.
function groupByRepere(nomenclatures, refsVues) {
  const groups = []
  const seen = new Map() // repereNum → index dans groups

  for (const r of nomenclatures) {
    const repere = refsVues.find(rv => rv.liaisons?.some(l => l.nomenclature_id === r.id))
    const key = repere ? `rv-${repere.id}` : `n-${r.id}`
    const repereNum = repere?.part_number ?? null
    if (seen.has(key)) {
      groups[seen.get(key)].lignes.push(r)
    } else {
      seen.set(key, groups.length)
      groups.push({ repereNum, repere, lignes: [r] })
    }
  }
  return groups
}

export default function GroupePage() {
  const { id } = useParams()
  const [groupe, setGroupe] = useState(null)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [selectedRepere, setSelectedRepere] = useState(null)
  const [hoveredNomencId, setHoveredNomencId] = useState(null)
  const [hoveredRepere, setHoveredRepere] = useState(null)
  const [priceRef, setPriceRef] = useState(null)
  const [loading, setLoading] = useState(true)
  const rowRefs = useRef({})

  useEffect(() => {
    api.getGroupe(id).then(setGroupe).finally(() => setLoading(false))
  }, [id])

  const handleRepereClick = (repere) => {
    setSelectedRepere(repere)
    const ids = new Set(repere.liaisons?.map(l => l.nomenclature_id) ?? [])
    setSelectedIds(ids)
    setPriceRef(null)
    const firstId = repere.liaisons?.[0]?.nomenclature_id
    if (firstId) rowRefs.current[firstId]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const handleRowClick = (ref) => {
    setSelectedIds(new Set([ref.id]))
    const repere = groupe.refsVues.find(r => r.liaisons?.some(l => l.nomenclature_id === ref.id))
    setSelectedRepere(repere ?? null)
    if (priceRef?.id === ref.id) setPriceRef(null)
  }

  if (loading) return <progress className="or-progress" />
  if (!groupe) return <p className="or-muted">Groupe introuvable.</p>

  // Reconstruit un objet "page" pour PageViewer à partir des données du groupe
  const schemaPage = {
    image: groupe.image,
    thumb: groupe.thumb,
    numero: null,
    nomenclature_bbox: groupe.nomenclature_bbox,
    nomenclature_bboxes: groupe.nomenclature_bboxes,
  }

  const schemaBbox = groupe.schema_bbox ?? null

  return (
    <div>
      <div className="or-breadcrumb">
        <Link to="/catalogues">Catalogues</Link>
        <ChevronRight size={12} />
        <Link to={`/catalogue/${groupe.id_catalogue}`}>Catalogue</Link>
        <ChevronRight size={12} />
        <span>{groupe.titre}</span>
      </div>

      <div className="or-page-header">
        <div>
          <h1 className="or-page-title">{groupe.titre}</h1>
          {groupe.membres?.length > 0 && (
            <p className="or-page-subtitle">
              Pages : {groupe.membres.map(m => `P.${m.numero}`).join(', ')}
            </p>
          )}
        </div>
        <Link to={`/admin/groupe/${id}/edit`} className="or-btn or-btn-ghost or-btn-sm" style={{ display: 'flex', alignItems: 'center', gap: '.35rem' }}>
          <Settings size={14} /> Éditer le groupe
        </Link>
      </div>

      <div className="columns" style={{ alignItems: 'flex-start' }}>
        <div className="column is-half" style={{ position: 'sticky', top: '72px' }}>
          <PageViewer
            page={schemaPage}
            refsVues={groupe.refsVues ?? []}
            onRepereClick={handleRepereClick}
            onRepereHover={r => setHoveredRepere(r ?? null)}
            selectedNomencId={selectedIds.size === 1 ? [...selectedIds][0] : null}
            selectedRepereId={selectedRepere?.id ?? null}
            hoveredNomencIds={hoveredRepere ? new Set(hoveredRepere.liaisons?.map(l => l.nomenclature_id) ?? []) : hoveredNomencId ? new Set([hoveredNomencId]) : null}
            hoveredRepereId={hoveredNomencId ? groupe.refsVues?.find(rv => rv.liaisons?.some(l => l.nomenclature_id === hoveredNomencId))?.id ?? null : hoveredRepere?.id ?? null}
            schemaOnly
            schemaBbox={schemaBbox}
            showNomenclature={false}
          />
        </div>

        <div className="column is-half">
          <div className="or-box" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="or-table">
              <thead>
                <tr><th>#</th><th>Référence</th><th>Description</th><th>Qté</th><th>Nomenclature</th><th></th></tr>
              </thead>
              <tbody>
                {groupByRepere(groupe.nomenclatures ?? [], groupe.refsVues ?? []).map(({ repereNum, repere, lignes }) => (
                  lignes.map((r, i) => {
                    const isHighlighted = selectedIds.has(r.id)
                    const isHovered = hoveredNomencId === r.id || (hoveredRepere?.liaisons?.some(l => l.nomenclature_id === r.id) ?? false)
                    const isPriceOpen = priceRef?.id === r.id
                    const isFirst = i === 0
                    const hasVariantes = lignes.length > 1
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
                            borderTop: isFirst && hasVariantes ? '2px solid var(--border)' : undefined,
                            transition: 'background 0.1s',
                          }}
                        >
                          <td style={{ fontSize: '.8rem' }}>
                            {isFirst
                              ? repereNum != null
                                ? <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: isHighlighted ? '#6d28d9' : isHovered ? '#7c3aed' : '#8b5cf6', color: '#fff', borderRadius: '50%', width: 20, height: 20, fontSize: 10, fontWeight: 'bold', transition: 'background 0.1s' }}>{repereNum}</span>
                                : <span className="or-muted">{r.ref_no}</span>
                              : <span style={{ display: 'block', width: 20 }} />
                            }
                          </td>
                          <td><span className="or-mono">{r.part_number}</span></td>
                          <td style={{ fontSize: '.85rem' }}>{r.description}</td>
                          <td className="or-muted">{r.qty}</td>
                          <td style={{ fontSize: '.75rem', color: 'var(--text-muted)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                              title={r.page_titre}>
                            {hasVariantes ? (r.page_titre || `P.${r.page_numero}`) : ''}
                          </td>
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
                  })
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
