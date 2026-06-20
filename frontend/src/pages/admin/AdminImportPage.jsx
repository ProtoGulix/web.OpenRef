import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function AdminImportPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', marque: 'landrover', modele: '', annee_debut: '', annee_fin: '', langue: 'fr' })
  const [file, setFile] = useState(null)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState(null)

  const field = key => e => setForm(f => ({ ...f, [key]: e.target.value }))

  const startImport = async e => {
    e.preventDefault()
    if (!file) return setError('Sélectionnez un fichier')
    setError(null)
    setImporting(true)

    const data = new FormData()
    data.append('file', file)
    Object.entries(form).forEach(([k, v]) => v && data.append(k, v))

    try {
      const res = await fetch('/api/import', { method: 'POST', body: data })
      if (!res.ok) throw new Error(await res.text())
      const { jobId } = await res.json()
      navigate(`/admin/jobs?id=${jobId}`)
    } catch (err) {
      setError(err.message)
      setImporting(false)
    }
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 className="title">Importer un catalogue</h1>

      <form onSubmit={startImport}>
        <div className="field">
          <label className="label">Nom du catalogue</label>
          <input className="input" required value={form.name} onChange={field('name')} placeholder="Land Rover Series I — Parts Catalogue" />
        </div>
        <div className="columns">
          <div className="column field">
            <label className="label">Marque</label>
            <div className="select is-fullwidth">
              <select value={form.marque} onChange={field('marque')}>
                <option value="landrover">Land Rover</option>
                <option value="motobecane">Motobécane</option>
              </select>
            </div>
          </div>
          <div className="column field">
            <label className="label">Modèle</label>
            <input className="input" value={form.modele} onChange={field('modele')} placeholder="Series I" />
          </div>
        </div>
        <div className="columns">
          <div className="column field">
            <label className="label">Année début</label>
            <input className="input" type="number" value={form.annee_debut} onChange={field('annee_debut')} placeholder="1948" />
          </div>
          <div className="column field">
            <label className="label">Année fin</label>
            <input className="input" type="number" value={form.annee_fin} onChange={field('annee_fin')} placeholder="1953" />
          </div>
          <div className="column field">
            <label className="label">Langue</label>
            <div className="select is-fullwidth">
              <select value={form.langue} onChange={field('langue')}>
                <option value="fr">Français</option>
                <option value="en">English</option>
                <option value="es">Español</option>
              </select>
            </div>
          </div>
        </div>
        <div className="field">
          <label className="label">Fichier PDF</label>
          <input className="input" type="file" accept=".pdf,image/*" onChange={e => setFile(e.target.files[0])} />
        </div>

        {error && <div className="notification is-danger">{error}</div>}

        <button className={`button is-dark ${importing ? 'is-loading' : ''}`} type="submit" disabled={importing}>
          Lancer l'import
        </button>
      </form>
    </div>
  )
}
