import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { ChevronRight, Plus, Trash2, ExternalLink } from 'lucide-react'
import { api } from '../../api/client'

export default function AdminGroupesPage() {
  const { id: catalogueId } = useParams()
  const navigate = useNavigate()
  const [catalogue, setCatalogue] = useState(null)
  const [groupes, setGroupes] = useState([])
  const [loading, setLoading] = useState(true)
  const [newTitre, setNewTitre] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    Promise.all([api.getCatalogue(catalogueId), api.getCatalogueGroupes(catalogueId)])
      .then(([cat, grps]) => { setCatalogue(cat); setGroupes(grps) })
      .finally(() => setLoading(false))
  }, [catalogueId])

  const refresh = () => api.getCatalogueGroupes(catalogueId).then(setGroupes)

  const handleCreate = async () => {
    if (!newTitre.trim()) return
    setCreating(true)
    const g = await api.createGroupe(catalogueId, { titre: newTitre.trim() })
    navigate(`/admin/groupe/${g.id}/edit`)
  }

  const handleDelete = async (groupeId) => {
    if (!confirm('Supprimer ce groupe ?')) return
    await api.deleteGroupe(groupeId)
    await refresh()
  }

  if (loading) return <progress className="or-progress" />

  return (
    <div>
      <div className="or-breadcrumb">
        <Link to="/catalogues">Catalogues</Link>
        <ChevronRight size={12} />
        <Link to={`/admin/catalogue/${catalogueId}`}>{catalogue?.name}</Link>
        <ChevronRight size={12} />
        <span>Groupes</span>
      </div>

      <div className="or-page-header">
        <h1 className="or-page-title">Groupes de pages</h1>
      </div>

      {/* Créer un groupe */}
      <div className="or-box" style={{ marginBottom: '1.5rem', display: 'flex', gap: '.5rem', alignItems: 'center' }}>
        <input
          className="or-input"
          placeholder="Titre du nouveau groupe…"
          value={newTitre}
          onChange={e => setNewTitre(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleCreate()}
          style={{ flex: 1 }}
        />
        <button className="or-btn or-btn-primary" onClick={handleCreate} disabled={creating || !newTitre.trim()}>
          <Plus size={14} /> Créer
        </button>
      </div>

      {groupes.length === 0 && <p className="or-muted">Aucun groupe. Créez-en un ci-dessus.</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
        {groupes.map(g => (
          <div key={g.id} className="or-box" style={{ display: 'flex', alignItems: 'center', gap: '.75rem', padding: '.75rem 1rem' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontWeight: 600, fontSize: '.9rem', margin: 0 }}>{g.titre || <span className="or-muted">Sans titre</span>}</p>
              <p style={{ fontSize: '.75rem', color: 'var(--text-muted)', margin: 0 }}>
                {(g.pages_ids ?? []).length} page(s) membre(s)
              </p>
            </div>
            <Link to={`/admin/groupe/${g.id}/edit`} className="or-btn or-btn-primary or-btn-sm">Éditer</Link>
            <Link to={`/groupe/${g.id}`} className="or-btn or-btn-ghost or-btn-sm" target="_blank" title="Voir la page publique">
              <ExternalLink size={13} />
            </Link>
            <button className="or-btn or-btn-ghost or-btn-sm or-btn-icon-only" style={{ color: '#ef4444' }} onClick={() => handleDelete(g.id)} title="Supprimer">
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
