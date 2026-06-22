import { Link } from 'react-router-dom'
import { BookOpen, Wrench, CalendarDays, FileText } from 'lucide-react'

export default function CatalogueCard({ catalogue }) {
  const { id, name, marque, modele, annee_debut, annee_fin, nb_pages } = catalogue
  return (
    <div className="or-card">
      <div className="or-card-body">
        <div className="or-flex or-gap-2" style={{ marginBottom: '.5rem' }}>
          <BookOpen size={16} style={{ color: 'var(--brand)', flexShrink: 0 }} />
          <span style={{ fontWeight: 600, fontSize: '.9rem', color: 'var(--text)' }}>{name}</span>
        </div>
        {(marque || modele) && (
          <p className="or-muted" style={{ fontSize: '.8rem', marginBottom: '.3rem' }}>
            {marque}{modele ? ` — ${modele}` : ''}
          </p>
        )}
        <div className="or-flex or-gap-3" style={{ fontSize: '.75rem', color: 'var(--text-subtle)' }}>
          {(annee_debut || annee_fin) && (
            <span className="or-flex or-gap-1">
              <CalendarDays size={12} /> {annee_debut}–{annee_fin}
            </span>
          )}
          <span className="or-flex or-gap-1">
            <FileText size={12} /> {nb_pages} page{nb_pages !== 1 ? 's' : ''}
          </span>
        </div>
      </div>
      <div className="or-card-footer">
        <Link to={`/catalogue/${id}`}>Parcourir</Link>
        <Link to={`/admin/catalogue/${id}`}>
          <span className="or-flex or-gap-1"><Wrench size={12} /> Corriger</span>
        </Link>
      </div>
    </div>
  )
}
