import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import PricePanel from '../components/PricePanel'
import { api } from '../api/client'

export default function RefPage() {
  const { partNumber } = useParams()
  const decoded = decodeURIComponent(partNumber)
  const [refs, setRefs] = useState([])
  const [marque, setMarque] = useState('landrover')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.search(decoded).then(rows => {
      setRefs(rows)
      if (rows[0]?.marque) setMarque(rows[0].marque)
    }).finally(() => setLoading(false))
  }, [decoded])

  if (loading) return <progress className="progress is-info" />

  return (
    <div>
      <h1 className="title"><code>{decoded}</code></h1>
      {refs[0] && <p className="subtitle">{refs[0].description}</p>}

      <div className="box">
        <h2 className="subtitle is-5">Prix en temps réel</h2>
        <PricePanel partNumber={decoded} marque={marque} />
      </div>

      {refs.length > 0 && (
        <div className="box">
          <h2 className="subtitle is-5">Pages source</h2>
          <table className="table is-fullwidth is-size-7">
            <thead><tr><th>Catalogue</th><th>Page</th><th>Description</th></tr></thead>
            <tbody>
              {refs.map(r => (
                <tr key={r.id}>
                  <td>{r.catalogue_name} ({r.marque})</td>
                  <td><a href={`/page/${r.page_id}`}>P.{r.page_numero}</a></td>
                  <td>{r.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
