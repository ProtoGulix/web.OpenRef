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
  const [groupes, setGroupes] = useState([])
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([api.getCatalogue(id), api.getCataloguePages(id), api.getCatalogueGroupes(id)])
      .then(([cat, pgs, grps]) => { setCatalogue(cat); setPages(pgs); setGroupes(grps) })
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <progress className="or-progress" />
  if (!catalogue) return <p className="or-muted">Catalogue introuvable.</p>

  const schemaBbox = catalogue.column_template?.schema_bbox ?? null

  // IDs des pages appartenant à un groupe → exclues de la grille individuelle
  const pagesInGroupe = new Set(groupes.flatMap(g => g.pages_ids ?? []))
  const pagesLibres = filter
    ? pages.filter(p => p.type === filter && !pagesInGroupe.has(p.id))
    : pages.filter(p => !pagesInGroupe.has(p.id))

  // Pour les onglets, on compte sur toutes les pages (groupées ou non)
  const filteredAll = filter ? pages.filter(p => p.type === filter) : pages

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
        {/* Groupes en premier */}
        {groupes.map(g => (
          <div key={`g-${g.id}`} className="column is-2-desktop is-3-tablet is-4-mobile">
            <Link to={`/groupe/${g.id}`} className="or-card" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
              <div style={{ position: 'relative', width: '100%', paddingTop: schemaBbox && g.image_width && g.image_height
                ? `${((schemaBbox.y2 - schemaBbox.y1) / (schemaBbox.x2 - schemaBbox.x1) * 100).toFixed(3)}%`
                : '75%',
                background: '#f1f5f9', overflow: 'hidden' }}>
                {g.thumb && <img
                  src={g.thumb}
                  alt={g.titre}
                  style={{
                    position: 'absolute',
                    top: schemaBbox && g.image_height ? `${(-schemaBbox.y1 / (schemaBbox.y2 - schemaBbox.y1) * 100).toFixed(3)}%` : '0',
                    left: schemaBbox && g.image_width ? `${(-schemaBbox.x1 / (schemaBbox.x2 - schemaBbox.x1) * 100).toFixed(3)}%` : '0',
                    width: schemaBbox && g.image_width ? `${(g.image_width / (schemaBbox.x2 - schemaBbox.x1) * 100).toFixed(3)}%` : '100%',
                    maxWidth: 'none',
                    height: 'auto',
                    display: 'block',
                  }}
                />}
              </div>
              <div style={{ padding: '.5rem .65rem' }}>
                <p style={{ fontSize: '.75rem', fontWeight: 600, color: 'var(--text)', marginBottom: '.1rem' }}>{g.titre}</p>
                <p style={{ fontSize: '.7rem', color: 'var(--text-muted)' }}>
                  {(g.pages_ids ?? []).length} page{(g.pages_ids ?? []).length > 1 ? 's' : ''}
                </p>
              </div>
            </Link>
          </div>
        ))}

        {/* Pages non groupées */}
        {pagesLibres.map(p => (
          <div key={p.id} className="column is-2-desktop is-3-tablet is-4-mobile">
            <PageThumb page={p} schemaBbox={schemaBbox} />
          </div>
        ))}
      </div>
    </div>
  )
}
