import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import PageThumb from '../components/PageThumb'
import { api } from '../api/client'

const TYPES = ['', 'cover', 'index', 'schema', 'parts_list']
const TYPE_LABELS = { '': 'Tous', cover: 'Couverture', index: 'Index', schema: 'Schéma', parts_list: 'Liste pièces' }

export default function CataloguePage() {
  const { id } = useParams()
  const [catalogue, setCatalogue] = useState(null)
  const [pages, setPages] = useState([])
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([api.getCatalogue(id), api.getCataloguePages(id)])
      .then(([cat, pgs]) => { setCatalogue(cat); setPages(pgs) })
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <progress className="progress is-info" />
  if (!catalogue) return <p>Catalogue introuvable.</p>

  const filtered = filter ? pages.filter(p => p.type === filter) : pages

  return (
    <div>
      <nav className="breadcrumb"><ul>
        <li><Link to="/catalogues">Catalogues</Link></li>
        <li className="is-active"><a>{catalogue.name}</a></li>
      </ul></nav>

      <h1 className="title">{catalogue.name}</h1>
      <p className="subtitle">{catalogue.marque} — {catalogue.modele} ({catalogue.annee_debut}–{catalogue.annee_fin})</p>

      <div className="tabs mb-4">
        <ul>
          {TYPES.map(t => (
            <li key={t} className={filter === t ? 'is-active' : ''}>
              <a onClick={() => setFilter(t)}>{TYPE_LABELS[t]}</a>
            </li>
          ))}
        </ul>
      </div>

      <div className="columns is-multiline">
        {filtered.map(p => (
          <div key={p.id} className="column is-2-desktop is-3-tablet is-4-mobile">
            <PageThumb page={p} />
          </div>
        ))}
      </div>
    </div>
  )
}
