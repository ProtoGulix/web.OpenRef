import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ChevronRight, Pencil } from 'lucide-react'
import PageDetailView from '../components/PageDetailView'
import { api } from '../api/client'

// Fine enveloppe autour de PageDetailView (composant factorisé, réutilisé aussi par le
// dépliage des résultats de recherche) : n'ajoute que le fil d'Ariane et le lien admin.
// Le fil d'Ariane a besoin du numéro de page / catalogue avant que PageDetailView n'ait fini
// de charger — petit fetch dédié, léger, plutôt que de faire remonter l'état via callback.
export default function PageViewPage() {
  const { id } = useParams()
  const [pageMeta, setPageMeta] = useState(null)

  useEffect(() => {
    api.getPage(id).then(setPageMeta).catch(() => setPageMeta(null))
  }, [id])

  return (
    <div>
      <div className="or-breadcrumb">
        <Link to="/catalogues">Catalogues</Link>
        <ChevronRight size={12} />
        {pageMeta && <Link to={`/catalogue/${pageMeta.id_catalogue}`}>Catalogue</Link>}
        <ChevronRight size={12} />
        <span>{pageMeta ? `Page ${pageMeta.numero}` : 'Page'}</span>
        <Link
          to={`/admin/page/${id}/edit`}
          title="Éditer dans l'admin"
          style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '.3rem', fontSize: '.8rem', color: 'var(--text-muted, #888)', textDecoration: 'none' }}
        >
          <Pencil size={13} />
          Admin
        </Link>
      </div>

      <PageDetailView pageId={id} />
    </div>
  )
}
