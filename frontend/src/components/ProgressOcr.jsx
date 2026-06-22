import { CheckCircle } from 'lucide-react'

export default function ProgressOcr({ events }) {
  const pageDoneEvents = events.filter(e => e.type === 'page_done')
  const doneEvent = events.find(e => e.type === 'done')
  const total = doneEvent?.total ?? events.find(e => e.type === 'start')?.total ?? '?'
  const current = pageDoneEvents.length
  const pct = typeof total === 'number' && total > 0 ? Math.round((current / total) * 100) : 0

  return (
    <div>
      <div className="or-progress-label" style={{ marginBottom: '.5rem' }}>
        {doneEvent
          ? <span className="or-flex or-gap-1" style={{ color: '#15803d', fontWeight: 600 }}>
              <CheckCircle size={14} /> Import terminé ({total} pages)
            </span>
          : <span>Traitement page {current} / {total}…</span>
        }
      </div>
      <progress className={`or-progress ${doneEvent ? 'is-success' : ''}`} value={pct} max={100} />
      <div style={{ maxHeight: 160, overflowY: 'auto', marginTop: '.5rem' }}>
        {pageDoneEvents.slice(-5).reverse().map((e, i) => (
          <div key={i} className="or-muted" style={{ fontSize: '.75rem' }}>
            Page {e.page_num} — {e.blocs_count ?? 0} blocs extraits
          </div>
        ))}
      </div>
    </div>
  )
}
