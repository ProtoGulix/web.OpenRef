import { Link } from 'react-router-dom'

const TYPE_LABELS = {
  cover: 'Couverture', index: 'Index',
  schema: 'Schéma', parts_list: 'Liste pièces',
  view_only: 'Vue éclatée', mixed: 'Mixte',
}

export default function PageThumb({ page, adminLink = false }) {
  const target = adminLink ? `/admin/page/${page.id}/edit` : `/page/${page.id}`
  return (
    <Link to={target} className="or-card" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
      <div style={{ aspectRatio: '3/4', background: '#f1f5f9', overflow: 'hidden' }}>
        {page.thumb
          ? <img src={page.thumb} alt={`Page ${page.numero}`} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          : <div style={{ width: '100%', height: '100%', background: '#e2e8f0' }} />
        }
      </div>
      <div style={{ padding: '.5rem .65rem' }}>
        <p style={{ fontSize: '.75rem', fontWeight: 600, color: 'var(--text)', marginBottom: '.1rem' }}>P.{page.numero}</p>
        {page.titre && <p style={{ fontSize: '.7rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{page.titre}</p>}
        {page.type && <span className="or-badge or-badge-neutral" style={{ marginTop: '.2rem' }}>{TYPE_LABELS[page.type] ?? page.type}</span>}
      </div>
    </Link>
  )
}
