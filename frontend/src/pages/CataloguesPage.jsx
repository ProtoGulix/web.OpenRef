import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Upload } from 'lucide-react'
import CatalogueGrid from '../components/CatalogueGrid'
import { api } from '../api/client'

export default function CataloguesPage() {
  const [catalogues, setCatalogues] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getCatalogues().then(setCatalogues).finally(() => setLoading(false))
  }, [])

  if (loading) return <progress className="or-progress or-progress-indeterminate" />

  return (
    <div>
      <div className="or-page-header">
        <div>
          <h1 className="or-page-title">Catalogues</h1>
          <p className="or-page-subtitle">{catalogues.length} catalogue{catalogues.length !== 1 ? 's' : ''} importé{catalogues.length !== 1 ? 's' : ''}</p>
        </div>
        <Link to="/admin/import" className="or-btn or-btn-primary">
          <Upload size={15} /> Importer un catalogue
        </Link>
      </div>

      {catalogues.length === 0
        ? (
          <div className="or-alert or-alert-info">
            Aucun catalogue. <Link to="/admin/import" style={{ color: 'var(--brand)', fontWeight: 600 }}>Importer maintenant</Link>.
          </div>
        )
        : <CatalogueGrid catalogues={catalogues} />}
    </div>
  )
}
