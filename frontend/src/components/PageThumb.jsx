import { Link } from 'react-router-dom'

const TYPE_LABELS = {
  cover: 'Couverture', index: 'Index',
  schema: 'Schéma', parts_list: 'Liste pièces',
  view_only: 'Vue éclatée', mixed: 'Mixte',
}

export default function PageThumb({ page, adminLink = false, schemaBbox = null }) {
  const target = adminLink ? `/admin/page/${page.id}/edit` : `/page/${page.id}`
  const { image_width: refW, image_height: refH } = page
  const crop = schemaBbox && refW && refH

  // Toutes les dimensions en % du wrapper (width: 100%)
  // Le wrapper impose son ratio via padding-top trick.
  // L'image est positionnée en absolu, ses coordonnées en % du wrapper.

  // Zone schéma en fraction de l'image originale
  const sx1 = crop ? schemaBbox.x1 / refW : 0
  const sy1 = crop ? schemaBbox.y1 / refH : 0
  const sw  = crop ? (schemaBbox.x2 - schemaBbox.x1) / refW : 1
  const sh  = crop ? (schemaBbox.y2 - schemaBbox.y1) / refH : 1

  // Ratio du wrapper = ratio de la zone schéma (en tenant compte du ratio original)
  const origRatio = refW && refH ? refW / refH : 3 / 4
  const wrapperRatio = crop ? (sw * origRatio) / sh : origRatio
  const paddingTop = `${(1 / wrapperRatio * 100).toFixed(3)}%`

  // L'image entière (thumb) fait 1/sw * 100% de la largeur du wrapper
  // Son coin haut-gauche est décalé de -sx1/sw en X et -sy1/sh en Y (en % du wrapper)
  const imgW    = `${(1 / sw * 100).toFixed(3)}%`
  const imgLeft = `${(-sx1 / sw * 100).toFixed(3)}%`
  const imgTop  = `${(-sy1 / sh * 100).toFixed(3)}%`

  return (
    <Link to={target} className="or-card" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
      <div style={{ position: 'relative', width: '100%', paddingTop, background: '#f1f5f9', overflow: 'hidden' }}>
        {page.thumb && (
          <img
            src={page.thumb}
            alt={`Page ${page.numero}`}
            loading="lazy"
            style={{ position: 'absolute', top: imgTop, left: imgLeft, width: imgW, maxWidth: 'none', height: 'auto', display: 'block' }}
          />
        )}
      </div>
      <div style={{ padding: '.5rem .65rem' }}>
        <p style={{ fontSize: '.75rem', fontWeight: 600, color: 'var(--text)', marginBottom: '.1rem' }}>P.{page.numero}</p>
        {page.titre && <p style={{ fontSize: '.7rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{page.titre}</p>}
        {page.type && <span className="or-badge or-badge-neutral" style={{ marginTop: '.2rem' }}>{TYPE_LABELS[page.type] ?? page.type}</span>}
      </div>
    </Link>
  )
}
