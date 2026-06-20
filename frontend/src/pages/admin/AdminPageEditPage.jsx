import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import PageViewer from '../../components/PageViewer'
import ReferenceRow from '../../components/ReferenceRow'
import { api } from '../../api/client'

export default function AdminPageEditPage() {
  const { id } = useParams()
  const [page, setPage] = useState(null)
  const [refs, setRefs] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([api.getPage(id), api.getPageRefs(id)])
      .then(([pg, rs]) => { setPage(pg); setRefs(rs) })
      .finally(() => setLoading(false))
  }, [id])

  const updateRef = updated => setRefs(rs => rs.map(r => r.id === updated.id ? updated : r))

  const addRow = async () => {
    const created = await api.createRef(id, { plate_ref: '', part_number: '', description: '', qty: 1, remarks: '' })
    setRefs(rs => [...rs, created])
  }

  if (loading) return <progress className="progress is-info" />
  if (!page) return <p>Page introuvable.</p>

  const nb = refs.length
  const corriges = refs.filter(r => r.corrige).length

  return (
    <div>
      <nav className="breadcrumb"><ul>
        <li><Link to="/catalogues">Catalogues</Link></li>
        <li><Link to={`/admin/catalogue/${page.id_catalogue}`}>Catalogue</Link></li>
        <li className="is-active"><a>Page {page.numero}</a></li>
      </ul></nav>

      <h1 className="title mb-2">Page {page.numero} — {page.titre || '(sans titre)'}</h1>
      <p className="subtitle is-6">{corriges} / {nb} références corrigées</p>

      <div className="columns" style={{ alignItems: 'flex-start' }}>
        <div className="column is-half" style={{ position: 'sticky', top: '1rem' }}>
          <PageViewer page={page} refs={refs} />
        </div>

        <div className="column is-half">
          <table className="table is-fullwidth is-size-7">
            <thead>
              <tr>
                <th>#</th>
                <th>Référence</th>
                <th>Description</th>
                <th>Qté</th>
                <th>Remarques</th>
                <th>Conf.</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {refs.map(r => (
                <ReferenceRow key={r.id} ref={r} onUpdated={updateRef} />
              ))}
            </tbody>
          </table>
          <button className="button is-small is-light" onClick={addRow}>+ Ajouter une ligne</button>
        </div>
      </div>
    </div>
  )
}
