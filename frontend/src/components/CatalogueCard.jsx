import { Link } from 'react-router-dom'

export default function CatalogueCard({ catalogue }) {
  const { id, name, marque, modele, annee_debut, annee_fin, nb_pages } = catalogue
  return (
    <div className="card">
      <div className="card-content">
        <p className="title is-5">{name}</p>
        <p className="subtitle is-6">{marque} — {modele}</p>
        {(annee_debut || annee_fin) && (
          <p className="is-size-7 has-text-grey">{annee_debut}–{annee_fin}</p>
        )}
        <p className="is-size-7">{nb_pages} page{nb_pages !== 1 ? 's' : ''}</p>
      </div>
      <div className="card-footer">
        <Link className="card-footer-item" to={`/catalogue/${id}`}>Voir</Link>
        <Link className="card-footer-item" to={`/admin/catalogue/${id}`}>Corriger</Link>
      </div>
    </div>
  )
}
