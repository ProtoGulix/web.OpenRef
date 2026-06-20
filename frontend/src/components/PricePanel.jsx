import { useCallback, useState } from 'react'
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
    if (event.type === 'change') setRates(event.change)
    else if (event.type === 'site_start') setSites(s => ({ ...s, [event.site]: { status: 'loading', items: [] } }))
    else if (event.type === 'site_done') setSites(s => ({ ...s, [event.site]: { status: 'done', items: event.items, count: event.count } }))
    else if (event.type === 'site_error') setSites(s => ({ ...s, [event.site]: { status: 'error', items: [], error: event.error } }))
    else if (event.type === 'done') setDone(true)
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
      <div className="tags mb-3">
        {Object.entries(sites).map(([site, state]) => (
          <span key={site} className="mr-2">
            <strong>{site}</strong>&nbsp;<SiteStatusBadge status={state.status} count={state.count} />
          </span>
        ))}
        {done && <span className="tag is-light">Terminé</span>}
      </div>

      {sorted.length > 0 && (
        <table className="table is-fullwidth is-hoverable is-size-7">
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
                <td><strong>{item.source}</strong></td>
                <td>{item.name}</td>
                <td className="has-text-weight-semibold">{formatPrice(item.price, item.devise, rates)}</td>
                <td>{item.inc_vat ? 'TTC' : 'HT'}</td>
                <td>{item.manufacturer}</td>
                <td>
                  {item.link && <a href={item.link} target="_blank" rel="noreferrer" className="button is-small is-light">Voir</a>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
