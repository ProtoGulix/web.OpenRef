import { useRef, useState, useEffect, useCallback } from 'react'

const HANDLE_SIZE = 10
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

function handleCursor(pos) {
  const map = { nw: 'nw-resize', n: 'n-resize', ne: 'ne-resize', e: 'e-resize',
                 se: 'se-resize', s: 's-resize', sw: 'sw-resize', w: 'w-resize' }
  return map[pos]
}

/**
 * BboxEditor — rectangle redimensionnable superposé sur une image.
 * Props :
 *   bbox       : { x1, y1, x2, y2 } en coordonnées image originale
 *   imageW/H   : dimensions originales de l'image
 *   displayW/H : dimensions d'affichage (CSS) de l'image
 *   onChange   : (newBbox) => void  — appelé à chaque fin de drag
 */
export default function BboxEditor({ bbox, imageW, imageH, displayW, displayH, onChange, inactive = false }) {
  const containerRef = useRef(null)
  const dragRef = useRef(null)  // { type: 'move'|handle, startX, startY, startBbox }

  // bbox en coordonnées image
  const [rect, setRect] = useState(bbox)
  useEffect(() => setRect(bbox), [bbox])

  const scaleX = displayW / imageW
  const scaleY = displayH / imageH

  // Coordonnées affichage
  const dr = {
    x1: rect.x1 * scaleX,
    y1: rect.y1 * scaleY,
    x2: rect.x2 * scaleX,
    y2: rect.y2 * scaleY,
  }

  const onMouseDown = useCallback((e, type) => {
    e.preventDefault()
    e.stopPropagation()
    const containerRect = containerRef.current.getBoundingClientRect()
    dragRef.current = {
      type,
      startX: e.clientX - containerRect.left,
      startY: e.clientY - containerRect.top,
      startBbox: { ...rect },
    }

    const onMove = (ev) => {
      if (!dragRef.current) return
      const cx = ev.clientX - containerRect.left
      const cy = ev.clientY - containerRect.top
      const dx = (cx - dragRef.current.startX) / scaleX
      const dy = (cy - dragRef.current.startY) / scaleY
      const { startBbox, type } = dragRef.current

      let { x1, y1, x2, y2 } = startBbox

      if (type === 'move') {
        const w = x2 - x1, h = y2 - y1
        x1 = Math.max(0, Math.min(imageW - w, x1 + dx))
        y1 = Math.max(0, Math.min(imageH - h, y1 + dy))
        x2 = x1 + w
        y2 = y1 + h
      } else {
        if (type.includes('n')) y1 = Math.max(0, Math.min(y2 - 20, y1 + dy))
        if (type.includes('s')) y2 = Math.min(imageH, Math.max(y1 + 20, y2 + dy))
        if (type.includes('w')) x1 = Math.max(0, Math.min(x2 - 20, x1 + dx))
        if (type.includes('e')) x2 = Math.min(imageW, Math.max(x1 + 20, x2 + dx))
      }

      setRect({ x1: Math.round(x1), y1: Math.round(y1), x2: Math.round(x2), y2: Math.round(y2) })
    }

    const onUp = () => {
      if (dragRef.current) {
        onChange?.({ ...rect })
        dragRef.current = null
      }
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [rect, scaleX, scaleY, imageW, imageH, onChange])

  // Appel onChange au mouseup avec la valeur courante
  // On utilise un ref pour capturer rect à jour dans le closure onUp
  const rectRef = useRef(rect)
  useEffect(() => { rectRef.current = rect }, [rect])

  const handleMouseDown = useCallback((e, type) => {
    e.preventDefault()
    e.stopPropagation()
    const containerRect = containerRef.current.getBoundingClientRect()
    const startX = e.clientX - containerRect.left
    const startY = e.clientY - containerRect.top
    const startBbox = { ...rectRef.current }

    const onMove = (ev) => {
      const cx = ev.clientX - containerRect.left
      const cy = ev.clientY - containerRect.top
      const dx = (cx - startX) / scaleX
      const dy = (cy - startY) / scaleY
      let { x1, y1, x2, y2 } = startBbox

      if (type === 'move') {
        const w = x2 - x1, h = y2 - y1
        x1 = Math.max(0, Math.min(imageW - w, x1 + dx))
        y1 = Math.max(0, Math.min(imageH - h, y1 + dy))
        x2 = x1 + w; y2 = y1 + h
      } else {
        if (type.includes('n')) y1 = Math.max(0, Math.min(y2 - 20, y1 + dy))
        if (type.includes('s')) y2 = Math.min(imageH, Math.max(y1 + 20, y2 + dy))
        if (type.includes('w')) x1 = Math.max(0, Math.min(x2 - 20, x1 + dx))
        if (type.includes('e')) x2 = Math.min(imageW, Math.max(x1 + 20, x2 + dx))
      }

      setRect({ x1: Math.round(x1), y1: Math.round(y1), x2: Math.round(x2), y2: Math.round(y2) })
    }

    const onUp = () => {
      onChange?.(rectRef.current)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [scaleX, scaleY, imageW, imageH, onChange])

  // Position des 8 handles en coordonnées affichage
  const handlePos = {
    nw: [dr.x1, dr.y1],
    n:  [(dr.x1 + dr.x2) / 2, dr.y1],
    ne: [dr.x2, dr.y1],
    e:  [dr.x2, (dr.y1 + dr.y2) / 2],
    se: [dr.x2, dr.y2],
    s:  [(dr.x1 + dr.x2) / 2, dr.y2],
    sw: [dr.x1, dr.y2],
    w:  [dr.x1, (dr.y1 + dr.y2) / 2],
  }

  const color = inactive ? 'rgba(156,163,175,0.7)' : 'rgba(59,130,246,0.9)'
  const bgColor = inactive ? 'rgba(156,163,175,0.06)' : 'rgba(59,130,246,0.08)'

  return (
    <div ref={containerRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {/* Rectangle principal */}
      <div
        onMouseDown={inactive ? undefined : (e) => handleMouseDown(e, 'move')}
        style={{
          position: 'absolute',
          left: dr.x1, top: dr.y1,
          width: dr.x2 - dr.x1, height: dr.y2 - dr.y1,
          border: `2px solid ${color}`,
          background: bgColor,
          boxSizing: 'border-box',
          cursor: inactive ? 'default' : 'move',
          pointerEvents: inactive ? 'none' : 'all',
        }}
      />

      {/* 8 handles — seulement si actif */}
      {!inactive && HANDLES.map(h => {
        const [hx, hy] = handlePos[h]
        return (
          <div
            key={h}
            onMouseDown={(e) => handleMouseDown(e, h)}
            style={{
              position: 'absolute',
              left: hx - HANDLE_SIZE / 2,
              top: hy - HANDLE_SIZE / 2,
              width: HANDLE_SIZE,
              height: HANDLE_SIZE,
              background: '#3b82f6',
              border: '1px solid #fff',
              borderRadius: 2,
              cursor: handleCursor(h),
              pointerEvents: 'all',
            }}
          />
        )
      })}

      {/* Coordonnées — seulement si actif */}
      {!inactive && (
        <div style={{
          position: 'absolute',
          left: dr.x1, top: dr.y1 - 20,
          background: 'rgba(59,130,246,0.85)', color: '#fff',
          fontSize: 10, padding: '1px 5px', borderRadius: 2,
          pointerEvents: 'none', whiteSpace: 'nowrap',
        }}>
          {rect.x1},{rect.y1} → {rect.x2},{rect.y2}
        </div>
      )}
    </div>
  )
}
