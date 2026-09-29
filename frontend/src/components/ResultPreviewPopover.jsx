import { useEffect, useRef, useState } from 'react'
import PageViewer from './PageViewer'
import { loadPageData } from '../api/pageCache'

const POPOVER_SIZE = 320
const HOVER_DELAY_MS = 250
// Demi-largeur de la zone recadrée autour de la pastille, en pixels natifs de l'image.
// Une valeur fixe suffit ici : le zoom réel dépend du ratio recadrage/affichage, pas de
// cette constante à elle seule.
const CROP_HALF_SIZE = 220

// Popover d'aperçu au survol d'une ligne de résultat (desktop, pointer fin uniquement) :
// image de la page recadrée et zoomée autour de la pastille du repère, celle-ci mise en
// évidence. Sans position connue, affiche la page entière (miniature) avec un message.
export default function ResultPreviewPopover({ anchorRef, result, visible }) {
  const [shouldRender, setShouldRender] = useState(false)
  const [data, setData] = useState(null)
  const [coords, setCoords] = useState(null)
  const timerRef = useRef(null)
  const popoverRef = useRef(null)

  const pageId = result?.repere_page_id ?? result?.page_id

  // Délai avant apparition — évite un popover qui clignote au simple passage de la souris
  useEffect(() => {
    if (visible) {
      timerRef.current = setTimeout(() => setShouldRender(true), HOVER_DELAY_MS)
    } else {
      clearTimeout(timerRef.current)
      setShouldRender(false)
    }
    return () => clearTimeout(timerRef.current)
  }, [visible])

  useEffect(() => {
    if (!shouldRender || !pageId) return
    let cancelled = false
    loadPageData(pageId).then(d => { if (!cancelled) setData(d) })
    return () => { cancelled = true }
  }, [shouldRender, pageId])

  // Position : ancré sous la ligne survolée, contraint pour ne jamais sortir du viewport
  useEffect(() => {
    if (!shouldRender || !anchorRef.current) return
    const rect = anchorRef.current.getBoundingClientRect()
    let left = rect.left
    let top = rect.bottom + 8
    if (left + POPOVER_SIZE > window.innerWidth - 8) left = window.innerWidth - POPOVER_SIZE - 8
    if (left < 8) left = 8
    if (top + POPOVER_SIZE > window.innerHeight - 8) top = rect.top - POPOVER_SIZE - 8
    if (top < 8) top = 8
    setCoords({ left, top })
  }, [shouldRender, anchorRef])

  if (!shouldRender || !coords) return null

  const repere = data?.refsVues?.find(r => r.liaisons?.some(l => l.nomenclature_id === result.id))
  const hasPos = repere?.pos_x != null && repere?.pos_y != null

  return (
    <div
      ref={popoverRef}
      className="or-preview-popover"
      style={{ left: coords.left, top: coords.top, width: POPOVER_SIZE, height: POPOVER_SIZE }}
    >
      {!data ? (
        <progress className="or-progress or-progress-indeterminate" />
      ) : !hasPos ? (
        <div className="or-preview-popover-fallback">
          <img src={data.page.thumb || data.page.image} alt="" />
          <p>Repère non localisé</p>
        </div>
      ) : (
        <PageViewer
          page={data.page}
          refsVues={data.refsVues}
          highlightId={result.id}
          schemaBbox={{
            x1: Math.max(0, repere.pos_x - CROP_HALF_SIZE),
            y1: Math.max(0, repere.pos_y - CROP_HALF_SIZE),
            x2: repere.pos_x + CROP_HALF_SIZE,
            y2: repere.pos_y + CROP_HALF_SIZE,
          }}
        />
      )}
    </div>
  )
}
