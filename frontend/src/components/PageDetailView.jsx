import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, ChevronDown } from 'lucide-react'
import PageViewer from './PageViewer'
import PricePanel from './PricePanel'
import { loadPageData } from '../api/pageCache'

// Nombre de lignes affichées par défaut dans le dépliage résultats de recherche (showOpenPageLink)
// avant le lien "Voir plus" — /page/:id affiche toujours tout, pas de limite là-bas.
const COLLAPSED_ROWS = 8

// Vue complète d'une page : schéma (avec pastilles de repère) + tableau des références.
// Composant factorisé, réutilisé par /page/:id (PageViewPage) et par le dépliage des résultats
// de recherche (ResultsTable) — même comportement partout : clic pastille ↔ ligne, prix, etc.
//
// `highlightRefId` : id de nomenclature à mettre en évidence dès le chargement (scroll + surbrillance),
// utilisé par le dépliage recherche pour pointer directement sur la référence trouvée.
// `showOpenPageLink` : affiche un lien "Ouvrir la page" (utile dans le dépliage, inutile sur /page/:id
// qui EST déjà cette page).
export default function PageDetailView({ pageId, highlightRefId = null, showOpenPageLink = false }) {
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
    let cancelled = false
    setLoading(true)
    // Passe par le cache partagé : si la page a été survolée juste avant (popover), le
    // dépliage réutilise directement les données déjà chargées au lieu de refaire les requêtes.
    loadPageData(pageId)
      .then(data => {
        if (cancelled || !data) return
        setPage(data.page)
        setRefs(data.refs)
        setRefsVues(data.refsVues)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [pageId])

  // Mise en évidence initiale de highlightRefId dès que les données sont chargées
  // (ou si la référence à surligner change, ex: sélection d'un autre résultat de recherche).
  useEffect(() => {
    if (highlightRefId == null || loading) return
    setSelectedIds(new Set([highlightRefId]))
    const repere = refsVues.find(r => r.liaisons?.some(l => l.nomenclature_id === highlightRefId))
    setSelectedRepere(repere ?? null)
    // Laisse le DOM se peindre avant de scroller (la ligne vient d'apparaître)
    requestAnimationFrame(() => {
      rowRefs.current[highlightRefId]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightRefId, loading])

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

  // Troncature de la liste, seulement dans le contexte "dépliage résultats" (showOpenPageLink) —
  // /page/:id continue d'afficher tout le tableau. Si la référence surlignée tombe au-delà de la
  // limite, on l'inclut quand même : le but du dépliage est justement de la montrer.
  const shouldTruncate = showOpenPageLink && refs.length > COLLAPSED_ROWS
  const visibleRefs = useMemo(() => {
    if (!shouldTruncate) return refs
    const head = refs.slice(0, COLLAPSED_ROWS)
    if (highlightRefId != null && !head.some(r => r.id === highlightRefId)) {
      const highlighted = refs.find(r => r.id === highlightRefId)
      // Remplace la dernière ligne du lot plutôt que d'en ajouter une 9e — la limite reste respectée.
      if (highlighted) return [...head.slice(0, -1), highlighted]
    }
    return head
  }, [refs, shouldTruncate, highlightRefId])
  const visibleIds = useMemo(() => new Set(visibleRefs.map(r => r.id)), [visibleRefs])
  const hiddenCount = refs.length - visibleRefs.length

  if (loading) return <progress className="or-progress or-progress-indeterminate" />
  if (!page) return <p className="or-muted">Page introuvable.</p>

  return (
    <div className="columns" style={{ alignItems: 'flex-start' }}>
      <div className="column is-half or-page-detail-schema">
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
          schemaBbox={page._isGroupe ? page._schemaBbox : null}
          showNomenclature={!page._isGroupe}
          visibleNomencIds={shouldTruncate ? visibleIds : null}
        />
      </div>

      <div className="column is-half">
        <div className="or-flex" style={{ justifyContent: 'space-between', marginBottom: '.75rem' }}>
          <h2 style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--text)', margin: 0 }}>
            {page.titre || `Page ${page.numero}`}
          </h2>
          {showOpenPageLink && (
            <Link to={`/page/${pageId}`} className="or-btn or-btn-secondary or-btn-sm">
              Ouvrir la page
            </Link>
          )}
        </div>

        <div className="or-box" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="or-table">
            <thead>
              <tr><th>#</th><th>Référence</th><th>Description</th><th>Qté</th><th>Remarques</th><th></th></tr>
            </thead>
            <tbody>
              {visibleRefs.map(r => {
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
                          <PricePanel partNumber={r.part_number} marque={page.marque} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>

          {hiddenCount > 0 && (
            <div style={{ padding: '.6rem 1rem', borderTop: '1px solid var(--border)', textAlign: 'center' }}>
              <Link to={`/page/${pageId}`} className="or-btn or-btn-ghost or-btn-sm">
                <ChevronDown size={13} /> Voir les {hiddenCount} autres référence{hiddenCount !== 1 ? 's' : ''}
                {page._isGroupe ? ' sur le groupe complet' : ' sur la page complète'}
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
