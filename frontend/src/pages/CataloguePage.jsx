import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import PageThumb from '../components/PageThumb'
import { api } from '../api/client'

const TYPES = ['', 'cover', 'index', 'schema', 'parts_list', 'view_only', 'mixed']
const TYPE_LABELS = {
  '': 'Toutes', cover: 'Couverture', index: 'Index',
  schema: 'Schéma', parts_list: 'Liste pièces', view_only: 'Vue éclatée', mixed: 'Mixte',
}

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

  if (loading) return <progress className="or-progress" />
  if (!catalogue) return <p className="or-muted">Catalogue introuvable.</p>

  const filtered = filter ? pages.filter(p => p.type === filter) : pages

  return (
    <div>
      <div className="or-breadcrumb">
        <Link to="/catalogues">Catalogues</Link>
        <ChevronRight size={12} className="or-breadcrumb-sep" />
        <span>{catalogue.name}</span>
      </div>

      <div className="or-page-header">
        <div>
          <h1 className="or-page-title">{catalogue.name}</h1>
          <p className="or-page-subtitle">
            {catalogue.marque}{catalogue.modele ? ` — ${catalogue.modele}` : ''}
            {(catalogue.annee_debut || catalogue.annee_fin) ? ` · ${catalogue.annee_debut}–${catalogue.annee_fin}` : ''}
            {' · '}{pages.length} pages
          </p>
        </div>
      </div>

      <div className="or-tabs">
        {TYPES.filter(t => t === '' || pages.some(p => p.type === t)).map(t => (
          <button key={t} className={`or-tab${filter === t ? ' active' : ''}`} onClick={() => setFilter(t)}>
            {TYPE_LABELS[t]}
            {t !== '' && <span className="or-badge or-badge-neutral" style={{ marginLeft: '.35rem' }}>
              {pages.filter(p => p.type === t).length}
            </span>}
          </button>
        ))}
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
