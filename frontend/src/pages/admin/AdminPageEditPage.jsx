import { useEffect, useState, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import PageViewer from '../../components/PageViewer'
import BboxEditor from '../../components/BboxEditor'
import ReferenceRow from '../../components/ReferenceRow'
import { api } from '../../api/client'
import {
  X, Square, Plus, CheckCircle, AlertCircle, RotateCcw, ChevronRight
} from 'lucide-react'

const NO_NOMENCLATURE_TYPES = new Set(['cover', 'index'])

function normalizeBboxes(page) {
  if (page.nomenclature_bboxes?.length) return page.nomenclature_bboxes
  if (page.nomenclature_bbox) return [{ name: 'Nomenclature', ...page.nomenclature_bbox }]
  return []
}

export default function AdminPageEditPage() {
  const { id } = useParams()
  const [page, setPage] = useState(null)
  const [refs, setRefs] = useState([])
  const [loading, setLoading] = useState(true)
  const [blocs, setBlocs] = useState([])
  const [showBlocs, setShowBlocs] = useState(true)
  const [catalogue, setCatalogue] = useState(null)
  const [savingType, setSavingType] = useState(false)

  // Édition multi-bbox
  const [editBbox, setEditBbox] = useState(false)
  const [pendingBboxes, setPendingBboxes] = useState([])
  const [activeBboxIdx, setActiveBboxIdx] = useState(0)
  const [rerunning, setRerunning] = useState(false)
  const [rerunMsg, setRerunMsg] = useState(null)
  const [rerunStatus, setRerunStatus] = useState(null) // 'success' | 'error'

  // Dimensions image affichée
  const [displaySize, setDisplaySize] = useState(null)
  const [naturalSize, setNaturalSize] = useState(null)

  useEffect(() => {
    api.getPage(id).then(pg => {
      setPage(pg)
      setPendingBboxes(normalizeBboxes(pg))
      const refsPromise = pg.has_nomenclature
        ? api.getPageNomenclature(id)
        : api.getPageRefs(id)
      return Promise.all([refsPromise, api.getPageBlocs(id), api.getCatalogue(pg.id_catalogue)])
    })
      .then(([rs, bs, cat]) => { setRefs(rs); setBlocs(bs); setCatalogue(cat) })
      .finally(() => setLoading(false))
  }, [id])

  // Mesurer l'image quand on entre en mode édition bbox
  useEffect(() => {
    if (!editBbox) return
    const measure = () => {
      const img = document.querySelector('.page-viewer-img')
      if (img) {
        setDisplaySize({ w: img.offsetWidth, h: img.offsetHeight })
        if (img.naturalWidth) setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight })
      }
    }
    measure()
    const img = document.querySelector('.page-viewer-img')
    if (img) img.addEventListener('load', measure)
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('resize', measure)
      if (img) img.removeEventListener('load', measure)
    }
  }, [editBbox])

  const changeType = async (newType) => {
    setSavingType(true)
    try {
      const updated = await api.patchPage(id, { type: newType || null })
      setPage(p => ({ ...p, type: updated.type, has_nomenclature: updated.has_nomenclature }))
    } finally {
      setSavingType(false)
    }
  }

  const addBbox = () => {
    const w = naturalSize?.w || 2550
    const h = naturalSize?.h || 3300
    const next = {
      name: `Zone ${pendingBboxes.length + 1}`,
      x1: Math.round(w * 0.1),
      y1: Math.round(h * 0.3),
      x2: Math.round(w * 0.9),
      y2: Math.round(h * 0.6),
    }
    const updated = [...pendingBboxes, next]
    setPendingBboxes(updated)
    setActiveBboxIdx(updated.length - 1)
  }

  const removeBbox = (idx) => {
    const updated = pendingBboxes.filter((_, i) => i !== idx)
    setPendingBboxes(updated)
    setActiveBboxIdx(Math.min(activeBboxIdx, Math.max(0, updated.length - 1)))
  }

  const updateBboxAt = (idx, bbox) => {
    setPendingBboxes(prev => prev.map((b, i) => i === idx ? { ...b, ...bbox } : b))
  }

  const renameBboxAt = (idx, name) => {
    setPendingBboxes(prev => prev.map((b, i) => i === idx ? { ...b, name } : b))
  }

  const saveAndRerun = async () => {
    setRerunning(true)
    setRerunMsg(null)
    setRerunStatus(null)
    try {
      await api.patchPage(id, {
        nomenclature_bboxes: pendingBboxes,
        nomenclature_bbox: pendingBboxes[0] ?? null,
      })
      setPage(p => ({ ...p, nomenclature_bboxes: pendingBboxes, has_nomenclature: pendingBboxes.length > 0 }))
      const result = await api.rerunNomenclature(id)
      setRerunMsg(`${result.inserted} lignes extraites`)
      setRerunStatus('success')
      const rs = await api.getPageNomenclature(id)
      setRefs(rs)
      setEditBbox(false)
    } catch (e) {
      setRerunMsg(`Erreur : ${e.message}`)
      setRerunStatus('error')
    } finally {
      setRerunning(false)
    }
  }

  const updateRef = updated => setRefs(rs => rs.map(r => r.id === updated.id ? updated : r))

  const addRow = async () => {
    const created = await api.createRef(id, { plate_ref: '', part_number: '', description: '', qty: 1, remarks: '' })
    setRefs(rs => [...rs, created])
  }

  if (loading) return <progress className="or-progress" />
  if (!page) return <p>Page introuvable.</p>

  const nb = refs.length
  const corriges = refs.filter(r => r.corrige).length
  const isNomenclature = page?.has_nomenclature
  const canHaveNomenclature = !NO_NOMENCLATURE_TYPES.has(page?.type)

  return (
    <div>
      <div className="or-breadcrumb">
        <Link to="/catalogues">Catalogues</Link>
        <ChevronRight size={12} />
        <Link to={`/admin/catalogue/${page.id_catalogue}`}>Catalogue</Link>
        <ChevronRight size={12} />
        <span>Page {page.numero}</span>
      </div>

      <div className="or-flex or-gap-2" style={{ marginBottom: '0.5rem' }}>
        <h1 className="or-page-title">Page {page.numero} — {page.titre || '(sans titre)'}</h1>
        <select
          className="or-select"
          style={{ fontSize: '.8rem' }}
          value={page.type || ''}
          onChange={e => changeType(e.target.value)}
          disabled={savingType}
        >
          <option value="">— type —</option>
          <option value="cover">Couverture</option>
          <option value="index">Index</option>
          <option value="schema">Schéma</option>
          <option value="parts_list">Liste de pièces</option>
          <option value="view_only">Vue éclatée</option>
          <option value="mixed">Mixte</option>
        </select>
        {savingType && <span style={{ fontSize: '.8rem', color: 'var(--text-muted)' }}>Enregistrement…</span>}
      </div>

      <div className="or-page-header" style={{ marginBottom: '0.5rem' }}>
        <p style={{ fontSize: '.9rem', color: 'var(--text-muted)' }}>{corriges} / {nb} références corrigées</p>
        <div className="or-flex or-gap-2">
          {canHaveNomenclature && (
            <button
              className={`or-btn or-btn-sm ${editBbox ? 'or-btn-warning' : 'or-btn-secondary'}`}
              onClick={() => { setEditBbox(e => !e); setRerunMsg(null); setRerunStatus(null) }}
            >
              {editBbox ? <X size={14} /> : <Square size={14} />}
              <span>{editBbox ? 'Fermer l\'édition' : 'Zones nomenclature'}</span>
            </button>
          )}
          <label className="or-muted" style={{ fontSize: '.8rem', display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={showBlocs} onChange={e => setShowBlocs(e.target.checked)} style={{ marginRight: '4px' }} />
            Blocs OCR ({blocs.length})
          </label>
        </div>
      </div>

      {rerunMsg && (
        <div className={`or-alert ${rerunStatus === 'success' ? 'or-alert-success' : 'or-alert-error'}`} style={{ marginBottom: '1rem' }}>
          {rerunStatus === 'success' ? <CheckCircle size={15} className="or-alert-icon" /> : <AlertCircle size={15} className="or-alert-icon" />}
          {rerunMsg}
        </div>
      )}

      <div className="columns" style={{ alignItems: 'flex-start' }}>
        <div className="column is-half" style={{ position: 'sticky', top: '1rem' }}>
          <div style={{ position: 'relative' }}>
            <PageViewer
              page={editBbox ? { ...page, nomenclature_bbox: null, nomenclature_bboxes: [] } : page}
              refs={refs}
              blocs={showBlocs ? blocs : []}
              showNomenclature={!editBbox}
              columnTemplate={catalogue?.column_template}
            />
            {editBbox && displaySize && naturalSize && pendingBboxes.map((b, i) => (
              <BboxEditor
                key={i}
                bbox={b}
                imageW={naturalSize.w}
                imageH={naturalSize.h}
                displayW={displaySize.w}
                displayH={displaySize.h}
                onChange={i === activeBboxIdx ? (bbox) => updateBboxAt(i, bbox) : () => {}}
                inactive={i !== activeBboxIdx}
              />
            ))}
          </div>
        </div>

        <div className="column is-half">
          {editBbox ? (
            <>
              <div className="or-box" style={{ padding: 0, overflow: 'hidden' }}>
                <table className="or-table">
                  <thead>
                    <tr>
                      <th>Zone</th>
                      <th>Nom</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingBboxes.map((b, i) => (
                      <tr
                        key={i}
                        style={{ cursor: 'pointer', background: activeBboxIdx === i ? 'rgba(245,158,11,0.1)' : undefined }}
                        onClick={() => setActiveBboxIdx(i)}
                      >
                        <td>
                          <span style={{
                            display: 'inline-block',
                            width: 12, height: 12,
                            borderRadius: 2,
                            background: activeBboxIdx === i ? '#f59e0b' : '#6b7280',
                            marginRight: 6,
                            verticalAlign: 'middle',
                          }} />
                          {i + 1}
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          <input
                            className="or-input or-input-sm"
                            value={b.name}
                            onChange={e => renameBboxAt(i, e.target.value)}
                            style={{ border: 'none', background: 'transparent', padding: 0, boxShadow: 'none', fontWeight: activeBboxIdx === i ? 'bold' : 'normal' }}
                          />
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          <button
                            className="or-btn or-btn-ghost or-btn-sm or-btn-icon-only"
                            onClick={() => removeBbox(i)}
                            title="Supprimer"
                          >
                            <X size={12} />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {/* Ghost row */}
                    <tr
                      className="or-table-ghost"
                      onClick={addBbox}
                    >
                      <td colSpan={3}>
                        <Plus size={13} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                        Ajouter une zone…
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <button
                className={`or-btn or-btn-primary or-btn-sm ${rerunning ? 'is-loading' : ''}`}
                onClick={saveAndRerun}
                disabled={rerunning || pendingBboxes.length === 0}
              >
                <RotateCcw size={14} />
                <span>Sauvegarder et relancer l'OCR</span>
              </button>
            </>
          ) : isNomenclature ? (
            <div className="or-box" style={{ padding: 0, overflow: 'hidden' }}>
              <table className="or-table">
                <thead>
                  <tr>
                    <th>Réf. vue</th>
                    <th>Part Number</th>
                    <th>Description</th>
                    <th>Qté</th>
                    <th>Remarques</th>
                  </tr>
                </thead>
                <tbody>
                  {refs.map(r => (
                    <tr key={r.id}>
                      <td className="or-muted">{r.ref_no}</td>
                      <td><span className="or-mono">{r.part_number}</span></td>
                      <td>{r.description}</td>
                      <td>{r.qty}</td>
                      <td className="or-muted" style={{ fontSize: '.8rem' }}>{r.remarks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <>
              <div className="or-box" style={{ padding: 0, overflow: 'hidden' }}>
                <table className="or-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Référence</th>
                      <th>Description</th>
                      <th>Qté</th>
                      <th>Remarques</th>
                      <th>Conf.</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {refs.map(r => (
                      <ReferenceRow key={r.id} data={r} onUpdated={updateRef} />
                    ))}
                  </tbody>
                </table>
              </div>
              <button className="or-btn or-btn-secondary or-btn-sm" onClick={addRow}>
                <Plus size={14} />
                <span>Ajouter une ligne</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
