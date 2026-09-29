import { Link } from 'react-router-dom'
import { Tag, SearchX, Info } from 'lucide-react'

// Une requête "ressemble à une référence" si elle mélange lettres et chiffres sans espace
// (ex: ERR6066, AAU1053) — le scraper fonctionne indépendamment des catalogues, donc
// proposer la recherche de prix reste utile même si la référence n'est pas (encore) extraite.
const REF_LIKE = /^[A-Z]{1,4}\d{3,8}[A-Z]?$|^\d{5,9}$/i

export default function EmptyState({ q, marque, suggestions, marqueVide, onPickSuggestion }) {
  const looksLikeRef = REF_LIKE.test(q.trim())

  return (
    <div className="or-empty-state">
      <div className="or-alert or-alert-info">
        <SearchX size={16} className="or-alert-icon" />
        <div>
          <p style={{ fontWeight: 600, marginBottom: '.15rem' }}>Aucun résultat pour « {q} »</p>
          <p style={{ fontSize: '.85rem' }}>Aucune référence extraite ne correspond exactement à cette recherche.</p>
        </div>
      </div>

      {looksLikeRef && (
        <div className="or-box" style={{ marginTop: '1rem' }}>
          <p className="or-section-title">Chercher directement chez les fournisseurs</p>
          <p className="or-muted" style={{ fontSize: '.85rem', marginBottom: '.75rem' }}>
            « {q} » ressemble à une référence pièce. Le comparateur de prix fonctionne indépendamment
            des catalogues : même si elle n'a pas encore été extraite d'un catalogue, elle peut exister chez un fournisseur.
          </p>
          <Link to={`/ref/${encodeURIComponent(q.trim())}`} className="or-btn or-btn-primary">
            <Tag size={15} /> Chercher les prix chez les fournisseurs
          </Link>
        </div>
      )}

      {suggestions && suggestions.length > 0 && (
        <div className="or-box" style={{ marginTop: '1rem' }}>
          <p className="or-section-title">Références proches</p>
          <div className="or-flex or-gap-2" style={{ flexWrap: 'wrap' }}>
            {suggestions.map(s => (
              <button key={s.id} type="button" className="or-chip" onClick={() => onPickSuggestion(s.part_number)}>
                <span className="or-mono" style={{ background: 'none', padding: 0 }}>{s.part_number}</span>
                {s.description && <span className="or-muted" style={{ fontSize: '.8em' }}> — {s.description.slice(0, 40)}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {marqueVide && (
        <div className="or-alert or-alert-warning" style={{ marginTop: '1rem' }}>
          <Info size={16} className="or-alert-icon" />
          <div>
            <p style={{ fontWeight: 600, marginBottom: '.15rem' }}>Aucune référence extraite pour cette marque</p>
            <p style={{ fontSize: '.85rem' }}>
              Les catalogues de cette marque n'ont pas encore de références corrigées ou extraites.
              Voir les <Link to="/catalogues" style={{ color: 'var(--brand)', fontWeight: 600 }}>catalogues disponibles</Link>{' '}
              ou le <Link to="/admin/jobs" style={{ color: 'var(--brand)', fontWeight: 600 }}>suivi des imports</Link>.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
