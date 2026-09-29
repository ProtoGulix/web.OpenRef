import { History, X } from 'lucide-react'

const STORAGE_KEY = 'openref_recent_searches'
const MAX_ITEMS = 5

// Petits helpers exportés pour que SearchPage puisse enregistrer une recherche
// sans dupliquer la logique de lecture/écriture localStorage.
export function loadRecentSearches() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function pushRecentSearch(q, marque) {
  try {
    const current = loadRecentSearches()
    const entry = { q, marque: marque || '' }
    const filtered = current.filter(e => !(e.q === entry.q && e.marque === entry.marque))
    const next = [entry, ...filtered].slice(0, MAX_ITEMS)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    return next
  } catch {
    return loadRecentSearches()
  }
}

export function clearRecentSearches() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch { /* localStorage indisponible, rien à faire */ }
}

const MARQUE_LABELS = { landrover: 'Land Rover', motobecane: 'Motobécane' }

export default function RecentSearches({ items, onSelect, onClear }) {
  if (!items || items.length === 0) return null

  return (
    <div className="or-recent-searches">
      <div className="or-flex or-gap-2" style={{ justifyContent: 'space-between', marginBottom: '.6rem' }}>
        <p className="or-section-title" style={{ marginBottom: 0 }}>
          <History size={14} style={{ marginRight: '.35rem', verticalAlign: -2 }} />
          Recherches récentes
        </p>
        <button type="button" className="or-btn or-btn-ghost or-btn-sm" onClick={onClear}>
          <X size={12} /> Vider
        </button>
      </div>
      <div className="or-flex or-gap-2" style={{ flexWrap: 'wrap' }}>
        {items.map((item, i) => (
          <button
            key={`${item.q}-${item.marque}-${i}`}
            type="button"
            className="or-chip"
            onClick={() => onSelect(item)}
          >
            {item.q}
            {item.marque && <span className="or-muted" style={{ fontSize: '.75em' }}> · {MARQUE_LABELS[item.marque] ?? item.marque}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
