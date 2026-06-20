export default function ProgressOcr({ events }) {
  const pageDoneEvents = events.filter(e => e.type === 'page_done')
  const doneEvent = events.find(e => e.type === 'done')
  const total = doneEvent?.total ?? events.find(e => e.type === 'start')?.total ?? '?'
  const current = pageDoneEvents.length

  const pct = typeof total === 'number' && total > 0 ? Math.round((current / total) * 100) : 0

  return (
    <div>
      <p className="mb-2">
        {doneEvent
          ? <span className="has-text-success has-text-weight-bold">Import terminé ({total} pages)</span>
          : <span>Traitement page {current} / {total}…</span>
        }
      </p>
      <progress className="progress is-info" value={pct} max={100}>{pct}%</progress>
      <div style={{ maxHeight: 200, overflowY: 'auto', fontSize: '0.75rem' }}>
        {pageDoneEvents.slice(-5).reverse().map((e, i) => (
          <div key={i} className="has-text-grey">
            Page {e.page_num} — {e.blocs_count ?? 0} blocs extraits
          </div>
        ))}
      </div>
    </div>
  )
}
