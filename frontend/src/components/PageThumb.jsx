import { Link } from 'react-router-dom'

const TYPE_LABELS = {
  cover: 'Couverture',
  index: 'Index',
  schema: 'Schéma',
  parts_list: 'Liste pièces',
}

export default function PageThumb({ page, adminLink = false }) {
  const target = adminLink ? `/admin/page/${page.id}/edit` : `/page/${page.id}`
  return (
    <Link to={target} className="card" style={{ display: 'block' }}>
      {page.thumb
        ? <div className="card-image"><figure className="image"><img src={page.thumb} alt={`Page ${page.numero}`} loading="lazy" /></figure></div>
        : <div className="card-image" style={{ background: '#eee', minHeight: 120 }} />
      }
      <div className="card-content" style={{ padding: '0.5rem' }}>
        <p className="is-size-7 has-text-weight-semibold">P.{page.numero}</p>
        {page.titre && <p className="is-size-7 has-text-grey">{page.titre}</p>}
        {page.type && <span className="tag is-light is-size-7">{TYPE_LABELS[page.type] ?? page.type}</span>}
      </div>
    </Link>
  )
}
