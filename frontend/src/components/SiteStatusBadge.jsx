import { Clock, Loader, CheckCircle, XCircle } from 'lucide-react'

export default function SiteStatusBadge({ status, count }) {
  if (status === 'pending') return (
    <span className="or-badge or-badge-neutral"><Clock size={11} /> En attente</span>
  )
  if (status === 'loading') return (
    <span className="or-badge or-badge-blue"><Loader size={11} className="spin" /> En cours…</span>
  )
  if (status === 'done') return (
    <span className="or-badge or-badge-green">
      <CheckCircle size={11} /> {count} résultat{count !== 1 ? 's' : ''}
    </span>
  )
  if (status === 'error') return (
    <span className="or-badge or-badge-red"><XCircle size={11} /> Erreur</span>
  )
  return null
}
