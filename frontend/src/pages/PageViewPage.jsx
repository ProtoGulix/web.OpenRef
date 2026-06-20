import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import PageViewer from '../components/PageViewer'
import PricePanel from '../components/PricePanel'
import { api } from '../api/client'

export default function PageViewPage() {
  const { id } = useParams()
  const [page, setPage] = useState(null)
  const [refs, setRefs] = useState([])
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([api.getPage(id), api.getPageRefs(id)])
      .then(([pg, rs]) => { setPage(pg); setRefs(rs) })
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <progress className="progress is-info" />
  if (!page) return <p>Page introuvable.</p>

  return (
    <div>
      <nav className="breadcrumb"><ul>
        <li><Link to="/catalogues">Catalogues</Link></li>
        <li><Link to={`/catalogue/${page.id_catalogue}`}>Catalogue</Link></li>
        <li className="is-active"><a>Page {page.numero}</a></li>
      </ul></nav>

      <div className="columns">
        <div className="column is-half">
          <PageViewer page={page} refs={refs} onRefClick={setSelected} />
        </div>

        <div className="column is-half">
          <h2 className="subtitle mb-2">{page.titre || `Page ${page.numero}`}</h2>

          {selected && (
            <div className="box mb-4">
              <p className="has-text-weight-bold">{selected.plate_ref} — <code>{selected.part_number}</code></p>
              <p>{selected.description}</p>
              <p className="mt-2 has-text-grey is-size-7">Chargement des prix…</p>
              <PricePanel partNumber={selected.part_number} marque="landrover" />
            </div>
          )}

          <table className="table is-fullwidth is-size-7 is-hoverable">
            <thead>
              <tr><th>#</th><th>Référence</th><th>Description</th><th>Qté</th></tr>
            </thead>
            <tbody>
              {refs.map(r => (
                <tr
                  key={r.id}
                  className={selected?.id === r.id ? 'is-selected' : ''}
                  onClick={() => setSelected(r)}
                  style={{ cursor: 'pointer' }}
                >
                  <td>{r.plate_ref}</td>
                  <td><code>{r.part_number}</code></td>
                  <td>{r.description}</td>
                  <td>{r.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
