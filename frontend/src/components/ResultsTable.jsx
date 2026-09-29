import { Fragment, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Tag, Copy } from 'lucide-react'
import PageDetailView from './PageDetailView'
import ResultPreviewPopover from './ResultPreviewPopover'
import { preloadPageData } from '../api/pageCache'

// matchMedia plutôt qu'un hook d'état : le popover ne doit exister QUE sur pointeur fin
// (souris) — un `hover` tactile qui resterait affiché gênerait plus qu'il n'aiderait.
const isFinePointer = () => typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches

// Tableau des résultats de recherche, pleine largeur. Une seule ligne dépliée à la fois
// (accordéon) : le clic affiche la vue page complète (PageDetailView, même composant que
// /page/:id) avec la référence trouvée mise en évidence et scrollée dans le tableau.
// Survol desktop (pointer fin) : popover d'aperçu recadré sur la pastille du repère, après
// un court délai — la page est préchargée dès le survol pour que le dépliage soit instantané.
export default function ResultsTable({ results }) {
  const [expandedId, setExpandedId] = useState(null)
  const [hoveredId, setHoveredId] = useState(null)
  const rowRefs = useRef({})

  const toggle = (r) => setExpandedId(prev => (prev === r.id ? null : r.id))

  const handleMouseEnter = (r) => {
    preloadPageData(r.repere_page_id ?? r.page_id)
    if (isFinePointer()) setHoveredId(r.id)
  }
  const handleMouseLeave = () => setHoveredId(null)

  return (
    <div className="or-box" style={{ padding: 0, overflow: 'hidden' }}>
      <table className="or-table">
        <thead>
          <tr>
            <th>Référence</th>
            <th>Repère</th>
            <th>Description</th>
            <th>Qté</th>
            <th>Marque / Modèle</th>
            <th>Catalogue</th>
            <th>Page</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {results.map(r => {
            const isExpanded = expandedId === r.id
            return (
              <Fragment key={r.id}>
                <tr
                  ref={el => { rowRefs.current[r.id] = el }}
                  onClick={() => toggle(r)}
                  onMouseEnter={() => handleMouseEnter(r)}
                  onMouseLeave={handleMouseLeave}
                  className={isExpanded ? 'or-result-row-selected' : undefined}
                  style={{ cursor: 'pointer' }}
                >
                  <td>
                    <span className="or-mono">{r.part_number}</span>
                    {r.doublon && (
                      <span className="or-badge or-badge-yellow" style={{ marginLeft: '.4rem' }} title="Cette référence apparaît plusieurs fois pour ce catalogue et cette page">
                        <Copy size={10} /> doublon
                      </span>
                    )}
                  </td>
                  <td>
                    {r.plate_ref
                      ? <span className="or-result-pastille">{r.plate_ref}</span>
                      : <span className="or-muted">—</span>
                    }
                  </td>
                  <td>{r.description}</td>
                  <td className="or-muted">{r.qty}</td>
                  <td className="or-muted" style={{ fontSize: '.8rem' }}>{r.marque}{r.modele ? ` — ${r.modele}` : ''}</td>
                  <td><Link to={`/catalogue/${r.catalogue_id}`} onClick={e => e.stopPropagation()} style={{ color: 'var(--brand)' }}>{r.catalogue_name}</Link></td>
                  <td>{r.page_id ? <span className="or-muted">P.{r.page_numero}</span> : '—'}</td>
                  <td onClick={e => e.stopPropagation()}>
                    <Link to={`/ref/${encodeURIComponent(r.part_number)}`} className="or-btn or-btn-secondary or-btn-sm">
                      <Tag size={12} /> Prix
                    </Link>
                  </td>
                </tr>

                {hoveredId === r.id && !isExpanded && (
                  <ResultPreviewPopover anchorRef={{ current: rowRefs.current[r.id] }} result={r} visible={hoveredId === r.id} />
                )}

                {isExpanded && (
                  <tr>
                    <td colSpan={8} style={{ padding: '1rem', background: 'var(--surface-alt)' }}>
                      <PageDetailView
                        pageId={r.repere_page_id ?? r.page_id}
                        highlightRefId={r.id}
                        showOpenPageLink
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
