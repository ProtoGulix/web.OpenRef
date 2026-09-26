import { Check } from 'lucide-react'

export default function PageMembresGrid({ pages, membresIds, schemaId, onToggle }) {
  return (
    <div>
      <p style={{ fontSize: '.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
        Cliquez sur une page pour l'ajouter ou la retirer du groupe.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '10px' }}>
        {pages.map(p => {
          const isMembre = membresIds.has(p.id)
          const isSchema = p.id === schemaId
          return (
            <div
              key={p.id}
              onClick={() => onToggle(p.id, isMembre)}
              style={{
                position: 'relative',
                borderRadius: 8,
                overflow: 'hidden',
                border: isSchema ? '2px solid var(--brand)' : isMembre ? '2px solid #8b5cf6' : '2px solid var(--border)',
                background: 'var(--surface)',
                cursor: 'pointer',
                boxShadow: isMembre ? 'var(--shadow)' : 'var(--shadow-sm)',
                transition: 'border-color .15s, box-shadow .15s',
                opacity: isMembre ? 1 : 0.6,
              }}
            >
              <div style={{ position: 'relative', width: '100%', paddingTop: '133%', background: '#f1f5f9', overflow: 'hidden' }}>
                {p.thumb
                  ? <img src={p.thumb} alt="" loading="lazy" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  : <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-subtle)', fontSize: '.7rem' }}>No img</div>
                }
                <div style={{
                  position: 'absolute', top: 5, right: 5,
                  width: 20, height: 20, borderRadius: '50%',
                  background: isMembre ? (isSchema ? 'var(--brand)' : '#8b5cf6') : 'rgba(255,255,255,0.7)',
                  border: isMembre ? 'none' : '1.5px solid var(--border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 1px 3px rgba(0,0,0,.2)',
                }}>
                  {isMembre && <Check size={11} color="#fff" strokeWidth={3} />}
                </div>
                {isSchema && (
                  <div style={{
                    position: 'absolute', bottom: 4, left: 4,
                    background: 'var(--brand)', color: '#fff',
                    fontSize: '9px', fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                  }}>Schéma</div>
                )}
              </div>
              <div style={{ padding: '4px 6px' }}>
                <p style={{ fontSize: '.72rem', fontWeight: 600, color: 'var(--text)', margin: 0 }}>P.{p.numero}</p>
                {p.titre && (
                  <p style={{ fontSize: '.65rem', color: 'var(--text-muted)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.titre}</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
