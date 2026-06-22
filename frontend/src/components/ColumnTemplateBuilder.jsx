import { useState, useRef, useEffect, useCallback } from 'react'
import { X } from 'lucide-react'

const ROLES = [
  { value: 'part_number', label: 'N° Pièce', color: '#3b82f6' },
  { value: 'qty',         label: 'Qté',      color: '#10b981' },
  { value: 'description', label: 'Désignation', color: '#f59e0b' },
  { value: 'ref_no',      label: 'Réf. vue', color: '#8b5cf6' },
  { value: 'remarks',     label: 'Remarques', color: '#ef4444' },
  { value: 'ignore',      label: 'Ignorer',   color: '#9ca3af' },
]

/**
 * CroppedImage — affiche un crop d'une image via canvas
 */
function CroppedImage({ src, bbox, onLoad, style }) {
  const canvasRef = useRef(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!src || !bbox) return
    const img = new Image()
    img.onload = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      const bboxW = bbox.x2 - bbox.x1
      const bboxH = bbox.y2 - bbox.y1
      // Afficher à 100% de la largeur du container
      const containerW = canvas.parentElement?.offsetWidth || 600
      const scale = containerW / bboxW
      canvas.width = containerW
      canvas.height = bboxH * scale
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, bbox.x1, bbox.y1, bboxW, bboxH, 0, 0, containerW, bboxH * scale)
      setLoaded(true)
      onLoad?.({ w: img.naturalWidth, h: img.naturalHeight }, { w: containerW, h: bboxH * scale })
    }
    img.src = src
  }, [src, bbox])

  return <canvas ref={canvasRef} className="ctb-img" style={{ ...style, display: 'block' }} />
}

/**
 * ColumnTemplateBuilder
 * Props:
 *   page       : { image, nomenclature_bbox }
 *   imageW/H   : dimensions originales
 *   onChange   : (template) => void
 *              template = { dividers: [{ x_rel: 0..1, role: 'description' }, ...] }
 *              x_rel = position relative dans la bbox (0=gauche, 1=droite)
 *
 * Affiche l'image croppée sur la bbox, avec des traits verticaux déplaçables.
 * Entre chaque paire de traits (et avant le premier / après le dernier) : label de rôle.
 */
export default function ColumnTemplateBuilder({ page, imageW, imageH, onChange }) {
  const containerRef = useRef(null)
  const [displaySize, setDisplaySize] = useState(null)
  const [naturalSize, setNaturalSize] = useState(null)
  // dividers : liste de { x_rel, role } triés par x_rel croissant
  // x_rel est relatif à la bbox (0 = x1, 1 = x2)
  const [dividers, setDividers] = useState([])
  // colonnes = zones entre dividers, chacune a un rôle
  // zones: [{ role }] — length = dividers.length + 1
  const [zones, setZones] = useState([{ role: 'part_number' }])

  const bbox = page?.nomenclature_bbox
  const dragging = useRef(null) // { idx, startX, startXRel }

  // Mesurer l'image affichée
  useEffect(() => {
    const measure = () => {
      const img = containerRef.current?.querySelector('.ctb-img')
      if (img) {
        setDisplaySize({ w: img.offsetWidth, h: img.offsetHeight })
        if (img.naturalWidth) setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight })
      }
    }
    measure()
    const img = containerRef.current?.querySelector('.ctb-img')
    if (img) img.addEventListener('load', measure)
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('resize', measure)
      if (img) img.removeEventListener('load', measure)
    }
  }, [page])

  // Notifier le parent
  useEffect(() => {
    onChange?.({ dividers: dividers.map((d, i) => ({ x_rel: d.x_rel, role: zones[i + 1]?.role || 'description' })), zones })
  }, [dividers, zones])

  if (!bbox || !page) return <p className="has-text-grey">Aucune bbox de nomenclature détectée.</p>

  const bboxW = bbox.x2 - bbox.x1
  const bboxH = bbox.y2 - bbox.y1

  // Ajouter un trait au clic sur le fond
  const onClickContainer = (e) => {
    if (dragging.current !== null) return
    if (!displaySize) return
    const rect = containerRef.current.getBoundingClientRect()
    const xPx = e.clientX - rect.left
    const x_rel = Math.max(0.01, Math.min(0.99, xPx / displaySize.w))

    // Insérer en ordre croissant
    const newDividers = [...dividers, { x_rel }].sort((a, b) => a.x_rel - b.x_rel)
    const insertIdx = newDividers.findIndex(d => d.x_rel === x_rel)

    // Insérer une zone par défaut
    const newZones = [...zones]
    newZones.splice(insertIdx + 1, 0, { role: 'description' })

    setDividers(newDividers)
    setZones(newZones)
  }

  // Drag d'un trait
  const startDrag = useCallback((e, idx) => {
    e.preventDefault()
    e.stopPropagation()
    const containerRect = containerRef.current.getBoundingClientRect()
    dragging.current = { idx, startX: e.clientX, startXRel: dividers[idx].x_rel }

    const onMove = (ev) => {
      if (dragging.current === null) return
      const dx = ev.clientX - dragging.current.startX
      const dx_rel = dx / displaySize.w
      const newXRel = Math.max(0.01, Math.min(0.99, dragging.current.startXRel + dx_rel))

      setDividers(prev => {
        const next = [...prev]
        next[dragging.current.idx] = { ...next[dragging.current.idx], x_rel: newXRel }
        return next.sort((a, b) => a.x_rel - b.x_rel)
      })
    }

    const onUp = () => {
      dragging.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [dividers, displaySize])

  // Supprimer un trait
  const removeDivider = (idx) => {
    const newDividers = dividers.filter((_, i) => i !== idx)
    const newZones = zones.filter((_, i) => i !== idx + 1)
    setDividers(newDividers)
    setZones(newZones)
  }

  // Changer le rôle d'une zone
  const setZoneRole = (zoneIdx, role) => {
    setZones(prev => prev.map((z, i) => i === zoneIdx ? { ...z, role } : z))
  }

  // Zones visuelles : [0, div[0].x_rel, div[1].x_rel, ..., 1]
  const boundaries = [0, ...dividers.map(d => d.x_rel), 1]
  const zoneRects = boundaries.slice(0, -1).map((start, i) => ({
    left: start,
    width: boundaries[i + 1] - start,
    role: zones[i]?.role || 'description',
  }))

  const roleColor = (role) => ROLES.find(r => r.value === role)?.color || '#9ca3af'
  const roleLabel = (role) => ROLES.find(r => r.value === role)?.label || role

  return (
    <div>
      {/* Image croppée sur la bbox avec traits */}
      <div
        ref={containerRef}
        onClick={onClickContainer}
        style={{ position: 'relative', cursor: 'crosshair', userSelect: 'none', overflow: 'hidden' }}
      >
        {/* Image affichée, on mesure sa taille naturelle puis on crop via canvas */}
        <CroppedImage
          src={page.image}
          bbox={bbox}
          onLoad={(nat, disp) => { setNaturalSize(nat); setDisplaySize(disp) }}
          style={{ width: '100%', display: 'block' }}
        />

        {displaySize && (
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            {/* Zones colorées */}
            {zoneRects.map((z, i) => (
              <div key={i} style={{
                position: 'absolute',
                left: `${z.left * 100}%`,
                top: 0,
                width: `${z.width * 100}%`,
                height: '100%',
                background: roleColor(z.role) + '22',
                borderLeft: i === 0 ? 'none' : `2px solid ${roleColor(z.role)}`,
              }} />
            ))}

            {/* Traits diviseurs */}
            {dividers.map((d, i) => (
              <div
                key={i}
                onMouseDown={(e) => startDrag(e, i)}
                onClick={e => e.stopPropagation()}
                style={{
                  position: 'absolute',
                  left: `${d.x_rel * 100}%`,
                  top: 0,
                  width: 4,
                  height: '100%',
                  background: '#1d4ed8',
                  cursor: 'ew-resize',
                  transform: 'translateX(-2px)',
                  pointerEvents: 'all',
                  zIndex: 10,
                }}
              >
                {/* Poignée haut */}
                <div style={{
                  position: 'absolute',
                  top: 4,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 14,
                  height: 14,
                  background: '#1d4ed8',
                  borderRadius: '50%',
                  border: '2px solid white',
                  cursor: 'ew-resize',
                }} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Labels de rôle sous l'image */}
      {displaySize && (
        <div style={{ display: 'flex', marginTop: 4, position: 'relative' }}>
          {zoneRects.map((z, i) => (
            <div key={i} style={{
              flex: z.width,
              padding: '2px 4px',
              minWidth: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <select
                  value={z.role}
                  onChange={e => setZoneRole(i, e.target.value)}
                  style={{
                    fontSize: 11,
                    border: `2px solid ${roleColor(z.role)}`,
                    borderRadius: 4,
                    padding: '1px 2px',
                    background: roleColor(z.role) + '22',
                    color: roleColor(z.role),
                    fontWeight: 'bold',
                    width: '100%',
                  }}
                >
                  {ROLES.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
                {i > 0 && (
                  <button
                    onClick={() => removeDivider(i - 1)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#9ca3af',
                      cursor: 'pointer',
                      fontSize: 12,
                      padding: 0,
                      lineHeight: 1,
                      flexShrink: 0,
                    }}
                    title="Supprimer ce trait"
                  ><X size={11} /></button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="is-size-7 has-text-grey mt-2">
        Cliquez sur l'image pour ajouter un trait de séparation. Faites glisser les traits pour les déplacer.
      </p>
    </div>
  )
}
