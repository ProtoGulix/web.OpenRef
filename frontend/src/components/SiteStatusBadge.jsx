export default function SiteStatusBadge({ status, count }) {
  if (status === 'pending') return <span className="tag is-light">⏳ En attente</span>
  if (status === 'loading') return <span className="tag is-info is-light">⏳ En cours…</span>
  if (status === 'done') return <span className="tag is-success is-light">✅ {count} résultat{count !== 1 ? 's' : ''}</span>
  if (status === 'error') return <span className="tag is-danger is-light">❌ Erreur</span>
  return null
}
