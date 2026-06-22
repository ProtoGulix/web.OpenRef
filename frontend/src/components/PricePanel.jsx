import { useCallback, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { useSse } from '../hooks/useSse'
import SiteStatusBadge from './SiteStatusBadge'

function formatPrice(price, devise, rates) {
  const eur = devise === 'GBP' ? (price * (rates?.GBPEUR ?? 1.163)).toFixed(2) : price.toFixed(2)
  const gbp = devise === 'EUR' ? (price * (rates?.EURGBP ?? 0.86)).toFixed(2) : price.toFixed(2)
  return devise === 'GBP'
    ? `£${price.toFixed(2)} (≈ €${eur})`
    : `€${price.toFixed(2)} (≈ £${gbp})`
}

export default function PricePanel({ partNumber, marque }) {
  const [sites, setSites] = useState({})
  const [rates, setRates] = useState(null)
  const [done, setDone] = useState(false)

  const onEvent = useCallback(event => {
    if (event.type === 'change')      setRates(event.change)
    else if (event.type === 'site_start') setSites(s => ({ ...s, [event.site]: { status: 'loading', items: [] } }))
    else if (event.type === 'site_done')  setSites(s => ({ ...s, [event.site]: { status: 'done', items: event.items, count: event.count } }))
    else if (event.type === 'site_error') setSites(s => ({ ...s, [event.site]: { status: 'error', items: [], error: event.error } }))
    else if (event.type === 'done')   setDone(true)
  }, [])

  const url = partNumber && marque
    ? `/api/prix/stream?ref=${encodeURIComponent(partNumber)}&marque=${marque}`
    : null

  useSse(url, onEvent, [url])

  const allItems = Object.values(sites).flatMap(s => s.items ?? [])
  const sorted = [...allItems].sort((a, b) => {
    const toEur = (item) => item.devise === 'GBP' ? item.price * (rates?.GBPEUR ?? 1.163) : item.price
    return toEur(a) - toEur(b)
  })

  return (
    <div>
      <div className="or-flex or-gap-3" style={{ flexWrap: 'wrap', marginBottom: '1rem' }}>
        {Object.entries(sites).map(([site, state]) => (
          <span key={site} className="or-flex or-gap-1" style={{ fontSize: '.8rem' }}>
            <strong>{site}</strong>
            <SiteStatusBadge status={state.status} count={state.count} />
          </span>
        ))}
        {done && <span className="or-badge or-badge-green">Terminé</span>}
      </div>

      {sorted.length > 0 && (
        <div className="or-box" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="or-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Désignation</th>
                <th>Prix</th>
                <th>TVA</th>
                <th>Fabricant</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((item, i) => (
                <tr key={i}>
                  <td><strong style={{ fontSize: '.8rem' }}>{item.source}</strong></td>
                  <td style={{ fontSize: '.8rem' }}>{item.name}</td>
                  <td style={{ fontWeight: 600 }}>{formatPrice(item.price, item.devise, rates)}</td>
                  <td className="or-muted" style={{ fontSize: '.8rem' }}>{item.inc_vat ? 'TTC' : 'HT'}</td>
                  <td className="or-muted" style={{ fontSize: '.8rem' }}>{item.manufacturer}</td>
                  <td>
                    {item.link && (
                      <a href={item.link} target="_blank" rel="noreferrer" className="or-btn or-btn-ghost or-btn-sm">
                        <ExternalLink size={12} /> Voir
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
