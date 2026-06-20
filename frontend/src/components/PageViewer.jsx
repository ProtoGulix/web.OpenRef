import { useState } from 'react'

export default function PageViewer({ page, refs = [], onRefClick }) {
  const [hovered, setHovered] = useState(null)

  if (!page?.image) return <div className="has-text-grey">Pas d'image disponible.</div>

  return (
    <div style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
      <img
        src={page.image}
        alt={`Page ${page.numero}`}
        style={{ width: '100%', display: 'block' }}
        draggable={false}
      />
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
              borderColor: hovered === ref.id ? '#3273dc' : 'rgba(50,115,220,0.4)',
              background: hovered === ref.id ? 'rgba(50,115,220,0.15)' : 'transparent',
              cursor: 'pointer',
              boxSizing: 'border-box',
            }}
          />
        ) : null
      ))}
    </div>
  )
}
