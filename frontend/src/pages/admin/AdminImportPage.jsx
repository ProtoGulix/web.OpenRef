import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Upload, AlertCircle } from 'lucide-react'

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
      <div className="or-page-header">
        <div>
          <h1 className="or-page-title">Importer un catalogue</h1>
          <p className="or-page-subtitle">PDF scanné ou natif, images</p>
        </div>
      </div>

      <div className="or-box">
        <form onSubmit={startImport}>
          <div className="or-field">
            <label className="or-label">Nom du catalogue</label>
            <input className="or-input" required value={form.name} onChange={field('name')} placeholder="Land Rover Series I — Parts Catalogue" />
          </div>

          <div className="columns">
            <div className="column or-field">
              <label className="or-label">Marque</label>
              <select className="or-select" value={form.marque} onChange={field('marque')}>
                <option value="landrover">Land Rover</option>
                <option value="motobecane">Motobécane</option>
              </select>
            </div>
            <div className="column or-field">
              <label className="or-label">Modèle</label>
              <input className="or-input" value={form.modele} onChange={field('modele')} placeholder="Series I" />
            </div>
          </div>

          <div className="columns">
            <div className="column or-field">
              <label className="or-label">Année début</label>
              <input className="or-input" type="number" value={form.annee_debut} onChange={field('annee_debut')} placeholder="1948" />
            </div>
            <div className="column or-field">
              <label className="or-label">Année fin</label>
              <input className="or-input" type="number" value={form.annee_fin} onChange={field('annee_fin')} placeholder="1953" />
            </div>
            <div className="column or-field">
              <label className="or-label">Langue</label>
              <select className="or-select" value={form.langue} onChange={field('langue')}>
                <option value="fr">Français</option>
                <option value="en">English</option>
                <option value="es">Español</option>
              </select>
            </div>
          </div>

          <div className="or-field">
            <label className="or-label">Fichier PDF ou image</label>
            <input className="or-input" type="file" accept=".pdf,image/*" onChange={e => setFile(e.target.files[0])} />
          </div>

          {error && (
            <div className="or-alert or-alert-error" style={{ marginBottom: '1rem' }}>
              <AlertCircle size={15} className="or-alert-icon" /> {error}
            </div>
          )}

          <button className={`or-btn or-btn-primary${importing ? ' is-loading' : ''}`} type="submit" disabled={importing}>
            <Upload size={15} /> Lancer l'import
          </button>
        </form>
      </div>
    </div>
  )
}
