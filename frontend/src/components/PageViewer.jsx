import { useState, useRef, useEffect } from 'react'

const COLUMN_ROLES = {
  part_number: { label: 'N° Pièce', color: '#3b82f6' },
  qty:         { label: 'Qté',      color: '#10b981' },
  description: { label: 'Désignation', color: '#f59e0b' },
  ref_no:      { label: 'Réf. vue', color: '#8b5cf6' },
  remarks:     { label: 'Remarques', color: '#ef4444' },
}

// Calcule le rectangle de la zone "schéma" en excluant les bboxes nomenclature.
// Retourne { x1, y1, x2, y2 } en pixels natifs, ou null si pas de bboxes exploitables.
function schemaZone(page, natW, natH) {
  if (!natW || !natH) return null
  const bboxes = page?.nomenclature_bboxes?.length
    ? page.nomenclature_bboxes
    : page?.nomenclature_bbox
      ? [page.nomenclature_bbox]
      : []
  if (!bboxes.length) return null

  const nomTop    = Math.min(...bboxes.map(b => b.y1))
  const nomBottom = Math.max(...bboxes.map(b => b.y2))
  const nomLeft   = Math.min(...bboxes.map(b => b.x1))

  // Nomenclature en bas → schéma = haut de l'image
  if (nomTop > natH * 0.4) return { x1: 0, y1: 0, x2: natW, y2: nomTop }
  // Nomenclature en haut → schéma = bas de l'image
  if (nomBottom < natH * 0.6) return { x1: 0, y1: nomBottom, x2: natW, y2: natH }
  // Nomenclature à droite → schéma = partie gauche
  if (nomLeft > natW * 0.4) return { x1: 0, y1: 0, x2: nomLeft, y2: natH }
  return null
}

export default function PageViewer({
  page, refs = [], blocs = [], refsVues = [],
  onRefClick, onRepereClick, onRepereHover,
  selectedNomencId = null, selectedRepereId = null,
  hoveredNomencIds = null, hoveredRepereId = null,
  showNomenclature = true, columnTemplate = null,
  schemaOnly = false, schemaBbox = null,
}) {
  const [hoveredBloc, setHoveredBloc] = useState(null)
  const imgRef = useRef(null)
  const containerRef = useRef(null)
  const [natSize, setNatSize] = useState({ natW: 1, natH: 1 })

  const onImgLoad = (e) => {
    setNatSize({ natW: e.target.naturalWidth, natH: e.target.naturalHeight })
  }

  // Image déjà en cache → onLoad ne se déclenche pas, on lit naturalWidth après mount
  useEffect(() => {
    const img = imgRef.current
    if (img?.complete && img.naturalWidth) {
      setNatSize({ natW: img.naturalWidth, natH: img.naturalHeight })
    }
  }, [page?.image])

  // Pour les overlays on a besoin de la taille affichée — on la lit sur le conteneur
  const [displayW, setDisplayW] = useState(1)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setDisplayW(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  if (!page?.image) return <div className="has-text-grey">Pas d'image disponible.</div>

  const { natW, natH } = natSize
  const crop = schemaBbox && natW > 1
    ? schemaBbox
    : (schemaOnly && natW > 1) ? schemaZone(page, natW, natH) : null

  const cropW = crop ? crop.x2 - crop.x1 : natW || 1
  const cropH = crop ? crop.y2 - crop.y1 : natH || 1

  // scaleX : px-écran par px-natif, dans le référentiel de la zone schéma affichée
  // Quand crop actif, le conteneur a la largeur de cropW à l'écran → scale = displayW / cropW
  const scaleX = crop ? displayW / (cropW || 1) : displayW / (natW || 1)
  const scaleY = scaleX
  const cropOffsetX = crop ? crop.x1 * scaleX : 0
  const cropOffsetY = crop ? crop.y1 * scaleY : 0

  const confColor = (conf) => {
    if (conf >= 80) return 'rgba(72,199,142,0.35)'
    if (conf >= 50) return 'rgba(255,224,138,0.4)'
    return 'rgba(255,100,100,0.35)'
  }

  // Crop : le conteneur prend l'aspect ratio de la zone schéma.
  // L'image est agrandie à natW/cropW * 100% et translatée pour centrer sur la zone crop.
  // translate() en % = % des dimensions de l'élément lui-même → pas besoin de px.
  const containerStyle = crop
    ? { position: 'relative', width: '100%', aspectRatio: `${cropW} / ${cropH}`, overflow: 'hidden' }
    : { position: 'relative', display: 'inline-block', width: '100%' }

  const imgStyle = crop
    ? {
        display: 'block',
        width: `${(natW / cropW * 100).toFixed(3)}%`,
        maxWidth: 'none',
        height: 'auto',
        transform: `translate(${(-crop.x1 / natW * 100).toFixed(3)}%, ${(-crop.y1 / natH * 100).toFixed(3)}%)`,
        transformOrigin: 'top left',
      }
    : { width: '100%', display: 'block' }

  return (
    <div ref={containerRef} style={containerStyle}>
      <img
        ref={imgRef}
        src={page.image}
        alt={`Page ${page.numero}`}
        className="page-viewer-img"
        style={imgStyle}
        draggable={false}
        onLoad={onImgLoad}
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
            title={`${ref.plate_ref} — ${ref.part_number}`}
            style={{
              position: 'absolute',
              left: `${ref.pos_left / 10}%`,
              top: `${ref.pos_top / 10}%`,
              width: `${(ref.width ?? 30) / 10}%`,
              height: `${(ref.height ?? 15) / 10}%`,
              border: '2px solid',
              borderColor: selectedNomencId === ref.id ? '#3273dc' : 'rgba(50,115,220,0.7)',
              background: selectedNomencId === ref.id ? 'rgba(50,115,220,0.15)' : 'transparent',
              cursor: 'pointer',
              boxSizing: 'border-box',
            }}
          />
        ) : null
      ))}

      {/* Overlay repères schéma */}
      {(() => {
        const anyHovered = hoveredRepereId != null
        return refsVues.filter(r => r.pos_x != null && r.pos_y != null).map(r => {
          const isSelected = selectedRepereId === r.id
          const isHovered = hoveredRepereId === r.id
          const hasLink = r.liaisons?.length > 0
          const active = isSelected || isHovered
          const dimmed = anyHovered && !isHovered && !isSelected
          return (
            <div
              key={r.id}
              onClick={() => onRepereClick?.(r)}
              onMouseEnter={() => onRepereHover?.(r)}
              onMouseLeave={() => onRepereHover?.(null)}
              title={hasLink ? `Repère ${r.part_number} → ${r.liaisons.map(l => l.part_number).join(', ')}` : `Repère ${r.part_number} (non lié)`}
              style={{
                position: 'absolute',
                left: Math.round(r.pos_x * scaleX - cropOffsetX),
                top: Math.round(r.pos_y * scaleY - cropOffsetY),
                transform: 'translate(-50%, -50%)',
                background: isSelected ? '#6d28d9' : isHovered ? '#7c3aed' : hasLink ? '#8b5cf6' : '#9ca3af',
                color: '#fff',
                borderRadius: '50%',
                width: active ? 24 : 20,
                height: active ? 24 : 20,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: active ? 11 : 10,
                fontWeight: 'bold',
                border: active ? '2px solid #fff' : '1.5px solid rgba(255,255,255,0.8)',
                boxShadow: isSelected ? '0 0 0 3px #6d28d9' : isHovered ? '0 0 0 3px rgba(124,58,237,0.5)' : '0 1px 4px rgba(0,0,0,0.35)',
                cursor: hasLink ? 'pointer' : 'default',
                userSelect: 'none',
                zIndex: isHovered ? 15 : 12,
                opacity: dimmed ? 0.25 : 1,
                transition: 'all 0.15s',
              }}
            >
              {r.part_number}
            </div>
          )
        })
      })()}

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
