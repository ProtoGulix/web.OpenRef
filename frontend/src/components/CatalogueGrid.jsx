import CatalogueCard from './CatalogueCard'

// Grille de catalogues réutilisable (page d'accueil + /catalogues).
// Grille Bulma (`columns`/`column`) pour le responsive, chrome visuel via `or-*`.
export default function CatalogueGrid({ catalogues }) {
  if (!catalogues || catalogues.length === 0) return null

  return (
    <div className="columns is-multiline">
      {catalogues.map(c => (
        <div key={c.id} className="column is-3-desktop is-half-tablet">
          <CatalogueCard catalogue={c} />
        </div>
      ))}
    </div>
  )
}
