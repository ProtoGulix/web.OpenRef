import { useState } from 'react'

export default function SearchBar({ onSearch, loading }) {
  const [q, setQ] = useState('')
  const [marque, setMarque] = useState('')

  const submit = e => {
    e.preventDefault()
    if (q.trim().length >= 2) onSearch(q.trim(), marque || undefined)
  }

  return (
    <form onSubmit={submit}>
      <div className="field has-addons">
        <div className="control is-expanded">
          <input
            className="input is-medium"
            type="text"
            placeholder="Référence ou description (ex: ERR6066, cylinder block...)"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
        </div>
        <div className="control">
          <div className="select is-medium">
            <select value={marque} onChange={e => setMarque(e.target.value)}>
              <option value="">Toutes marques</option>
              <option value="landrover">Land Rover</option>
              <option value="motobecane">Motobécane</option>
            </select>
          </div>
        </div>
        <div className="control">
          <button className={`button is-dark is-medium ${loading ? 'is-loading' : ''}`} type="submit">
            Rechercher
          </button>
        </div>
      </div>
    </form>
  )
}
