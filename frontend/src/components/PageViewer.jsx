import { useState, useRef, useEffect } from 'react'

const COLUMN_ROLES = {
  part_number: { label: 'N° Pièce', color: '#3b82f6' },
  qty:         { label: 'Qté',      color: '#10b981' },
  description: { label: 'Désignation', color: '#f59e0b' },
  ref_no:      { label: 'Réf. vue', color: '#8b5cf6' },
  remarks:     { label: 'Remarques', color: '#ef4444' },
}

export default function PageViewer({ page, refs = [], blocs = [], onRefClick, showNomenclature = true, columnTemplate = null }) {
  const [hovered, setHovered] = useState(null)
  const [hoveredBloc, setHoveredBloc] = useState(null)
  const imgRef = useRef(null)
  const [imgSize, setImgSize] = useState({ w: 1, h: 1, natW: 1, natH: 1 })

  useEffect(() => {
    const img = imgRef.current
    if (!img) return
    const update = () => setImgSize({ w: img.offsetWidth, h: img.offsetHeight, natW: img.naturalWidth || 1, natH: img.naturalHeight || 1 })
    if (img.complete) update()
    img.addEventListener('load', update)
    window.addEventListener('resize', update)
    return () => { img.removeEventListener('load', update); window.removeEventListener('resize', update) }
  }, [page?.image])

  if (!page?.image) return <div className="has-text-grey">Pas d'image disponible.</div>

  const scaleX = imgSize.w / imgSize.natW
  const scaleY = imgSize.h / imgSize.natH

  const confColor = (conf) => {
    if (conf >= 80) return 'rgba(72,199,142,0.35)'
    if (conf >= 50) return 'rgba(255,224,138,0.4)'
    return 'rgba(255,100,100,0.35)'
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
      <img
        ref={imgRef}
        src={page.image}
        alt={`Page ${page.numero}`}
        className="page-viewer-img"
        style={{ width: '100%', display: 'block' }}
        draggable={false}
      />

      {/* Overlay blocs OCR bruts */}
      {blocs.map(bloc => (
        <div
          key={bloc.id}
          onMouseEnter={() => setHoveredBloc(bloc.id)}
          onMouseLeave={() => setHoveredBloc(null)}
          title={`[conf:${bloc.conf}] ${bloc.text}`}
          style={{
            position: 'absolute',
            left: bloc.pos_left * scaleX,
            top: bloc.pos_top * scaleY,
            width: bloc.width * scaleX,
            height: bloc.height * scaleY,
            background: hoveredBloc === bloc.id ? 'rgba(100,100,255,0.25)' : confColor(bloc.conf),
            border: hoveredBloc === bloc.id ? '1px solid #3273dc' : '1px solid rgba(0,0,0,0.1)',
            boxSizing: 'border-box',
            cursor: 'default',
            fontSize: '0',
          }}
        />
      ))}

      {/* Overlay zones nomenclature + gabarit colonnes */}
      {showNomenclature && (() => {
        const bboxes = page?.nomenclature_bboxes?.length
          ? page.nomenclature_bboxes
          : page?.nomenclature_bbox
            ? [{ name: 'Nomenclature', ...page.nomenclature_bbox }]
            : []
        if (!bboxes.length) return null

        return bboxes.map((b, bIdx) => {
          const bboxW = b.x2 - b.x1
          const colEntries = columnTemplate
            ? Object.entries(columnTemplate).sort((a, b) => a[1] - b[1])
            : []
          return (
            <div key={bIdx} style={{
              position: 'absolute',
              left: b.x1 * scaleX,
              top: b.y1 * scaleY,
              width: bboxW * scaleX,
              height: (b.y2 - b.y1) * scaleY,
              border: '2px solid rgba(255, 140, 0, 0.85)',
              background: 'rgba(255, 165, 0, 0.08)',
              boxSizing: 'border-box',
              pointerEvents: 'none',
              overflow: 'hidden',
            }}>
              <span style={{
                position: 'absolute',
                top: -18,
                left: 0,
                background: 'rgba(255,140,0,0.85)',
                color: '#fff',
                fontSize: '10px',
                padding: '1px 5px',
                borderRadius: '2px',
                whiteSpace: 'nowrap',
              }}>{b.name || 'nomenclature'}</span>

              {colEntries.map(([role, xAbs]) => {
                const xRel = (xAbs - b.x1) / bboxW
                if (xRel <= 0 || xRel >= 1) return null
                const meta = COLUMN_ROLES[role] || { label: role, color: '#9ca3af' }
                return (
                  <div key={role} style={{
                    position: 'absolute',
                    left: `${xRel * 100}%`,
                    top: 0,
                    height: '100%',
                    width: 2,
                    background: meta.color,
                    opacity: 0.85,
                  }}>
                    <span style={{
                      position: 'absolute',
                      top: 2,
                      right: 4,
                      background: meta.color,
                      color: '#fff',
                      fontSize: '9px',
                      padding: '1px 3px',
                      borderRadius: '2px',
                      whiteSpace: 'nowrap',
                      lineHeight: 1.3,
                    }}>{meta.label}</span>
                  </div>
                )
              })}
            </div>
          )
        })
      })()}

      {/* Overlay références extraites */}
      {refs.map(ref => (
        ref.pos_left != null && ref.pos_top != null ? (
          <div
            key={ref.id}
            onClick={() => onRefClick?.(ref)}
            onMouseEnter={() => setHovered(ref.id)}
            onMouseLeave={() => setHovered(null)}
            title={`${ref.plate_ref} — ${ref.part_number}`}
            style={{
              position: 'absolute',
              left: `${ref.pos_left / 10}%`,
              top: `${ref.pos_top / 10}%`,
              width: `${(ref.width ?? 30) / 10}%`,
              height: `${(ref.height ?? 15) / 10}%`,
              border: '2px solid',
              borderColor: hovered === ref.id ? '#3273dc' : 'rgba(50,115,220,0.7)',
              background: hovered === ref.id ? 'rgba(50,115,220,0.15)' : 'transparent',
              cursor: 'pointer',
              boxSizing: 'border-box',
            }}
          />
        ) : null
      ))}

      {/* Tooltip bloc au survol */}
      {hoveredBloc && (() => {
        const b = blocs.find(b => b.id === hoveredBloc)
        if (!b) return null
        return (
          <div style={{
            position: 'absolute',
            left: b.pos_left * scaleX,
            top: Math.max(0, b.pos_top * scaleY - 28),
            background: 'rgba(0,0,0,0.8)',
            color: '#fff',
            fontSize: '10px',
            padding: '2px 6px',
            borderRadius: '3px',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            zIndex: 10,
          }}>
            {b.text} <span style={{ opacity: 0.6 }}>conf:{b.conf}</span>
          </div>
        )
      })()}
    </div>
  )
}
