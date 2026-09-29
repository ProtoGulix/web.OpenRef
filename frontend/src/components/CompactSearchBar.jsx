import { ArrowLeft, Search } from 'lucide-react'

// Barre de recherche compacte affichée en haut de la page en mode résultats
// (remplace le hero, qui reste réservé à l'accueil).
export default function CompactSearchBar({ q, setQ, marque, setMarque, onSearch, loading, onBackToHome }) {
  const submit = e => {
    e.preventDefault()
    if (q.trim().length >= 2) onSearch(q.trim(), marque || undefined)
  }

  return (
    <div className="or-compact-search">
      <button type="button" className="or-btn or-btn-ghost or-btn-sm" onClick={onBackToHome}>
        <ArrowLeft size={14} /> Retour à l'accueil
      </button>

      <form onSubmit={submit} className="or-compact-search-form">
        <div className="or-field-addons">
          <input
            className="or-input"
            type="text"
            placeholder="Référence ou description…"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
          <select
            className="or-select"
            style={{ maxWidth: 160 }}
            value={marque}
            onChange={e => setMarque(e.target.value)}
          >
            <option value="">Toutes marques</option>
            <option value="landrover">Land Rover</option>
            <option value="motobecane">Motobécane</option>
          </select>
          <button className={`or-btn or-btn-primary${loading ? ' is-loading' : ''}`} type="submit" disabled={loading}>
            <Search size={15} />
          </button>
        </div>
      </form>
    </div>
  )
}
