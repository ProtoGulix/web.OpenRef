import { useState } from 'react'
import { Search } from 'lucide-react'

export default function SearchBar({ onSearch, loading }) {
  const [q, setQ] = useState('')
  const [marque, setMarque] = useState('')

  const submit = e => {
    e.preventDefault()
    if (q.trim().length >= 2) onSearch(q.trim(), marque || undefined)
  }

  return (
    <form onSubmit={submit}>
      <div className="or-field-addons">
        <input
          className="or-input"
          style={{ fontSize: '1rem' }}
          type="text"
          placeholder="Référence ou description (ex: ERR6066, cylinder block…)"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        <select className="or-select" style={{ maxWidth: 180, fontSize: '1rem' }} value={marque} onChange={e => setMarque(e.target.value)}>
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
  )
}
