import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import CatalogueCard from '../components/CatalogueCard'
import { api } from '../api/client'

export default function CataloguesPage() {
  const [catalogues, setCatalogues] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getCatalogues().then(setCatalogues).finally(() => setLoading(false))
  }, [])

  if (loading) return <progress className="progress is-info" />

  return (
    <div>
      <div className="level">
        <div className="level-left"><h1 className="title level-item">Catalogues</h1></div>
        <div className="level-right">
          <Link to="/admin/import" className="button is-dark level-item">Importer un catalogue</Link>
        </div>
      </div>

      {catalogues.length === 0
        ? <p className="has-text-grey">Aucun catalogue importé. <Link to="/admin/import">Importer</Link></p>
        : (
          <div className="columns is-multiline">
            {catalogues.map(c => (
              <div key={c.id} className="column is-one-third-desktop is-half-tablet">
                <CatalogueCard catalogue={c} />
              </div>
            ))}
          </div>
        )}
    </div>
  )
}
