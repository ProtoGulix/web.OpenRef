import { useRef } from 'react'
import { Search, Layers } from 'lucide-react'

// Repli si l'API ne renvoie aucun exemple (base vide, ou catalogue sans référence corrigée)
const EXEMPLES_PAR_DEFAUT = ['ERR6066', 'AAU1053', '575673', 'RTC3866']

export default function SearchHero({ q, setQ, marque, setMarque, onSearch, loading, exemples }) {
  const inputRef = useRef(null)
  const items = exemples && exemples.length > 0 ? exemples : EXEMPLES_PAR_DEFAUT

  const submit = e => {
    e.preventDefault()
    if (q.trim().length >= 2) onSearch(q.trim(), marque || undefined)
  }

  const runExemple = ex => {
    setQ(ex)
    onSearch(ex, marque || undefined)
  }

  return (
    <div className="or-hero">
      <Layers size={30} strokeWidth={2} className="or-hero-icon" style={{ color: 'var(--brand)', marginBottom: '.5rem' }} />
      <h1 className="or-hero-title">Retrouvez une pièce en un instant</h1>
      <p className="or-hero-subtitle">
        Cherchez par référence ou description dans les catalogues importés, ou comparez les prix fournisseurs.
      </p>

      <form onSubmit={submit} className="or-hero-form">
        <div className="or-field-addons">
          <input
            ref={inputRef}
            autoFocus
            className="or-input"
            style={{ fontSize: '1rem' }}
            type="text"
            placeholder="Référence ou description (ex : ERR6066, cylinder block…)"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
          <select
            className="or-select"
            style={{ maxWidth: 180, fontSize: '1rem' }}
            value={marque}
            onChange={e => setMarque(e.target.value)}
          >
            <option value="">Toutes marques</option>
            <option value="landrover">Land Rover</option>
            <option value="motobecane">Motobécane</option>
          </select>
          <button className={`or-btn or-btn-primary or-btn-lg${loading ? ' is-loading' : ''}`} type="submit" disabled={loading}>
            <Search size={16} />
            Rechercher
          </button>
        </div>
      </form>

      <div className="or-hero-examples">
        <span className="or-muted" style={{ fontSize: '.8rem' }}>Exemples :</span>
        {items.map(ex => (
          <button key={ex} type="button" className="or-chip" onClick={() => runExemple(ex)}>
            {ex}
          </button>
        ))}
      </div>
    </div>
  )
}
