import { useEffect, useState, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import PageViewer from '../../components/PageViewer'
import BboxEditor from '../../components/BboxEditor'
import ReferenceRow from '../../components/ReferenceRow'
import NomenclatureRow from '../../components/NomenclatureRow'
import { api } from '../../api/client'
import {
  X, Square, Plus, CheckCircle, AlertCircle, RotateCcw, ChevronRight, ScanSearch, Eye
} from 'lucide-react'

const NO_NOMENCLATURE_TYPES = new Set(['cover', 'index'])

function ReperesOverlay({ naturalSize, displaySize, onAdd, pageId }) {
  const [pending, setPending] = useState(null) // { px, py, cx, cy, loading, detected }

  if (!naturalSize || !displaySize) return null
  const scaleX = displaySize.w / naturalSize.w
  const scaleY = displaySize.h / naturalSize.h

  const handleClick = async (e) => {
    if (pending) return
    const rect = e.currentTarget.getBoundingClientRect()
    const cx = Math.round((e.clientX - rect.left) / scaleX)
    const cy = Math.round((e.clientY - rect.top) / scaleY)
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    setPending({ px, py, cx, cy, loading: true, detected: null, input: '' })
    try {
      const res = await api.ocrPoint(pageId, cx, cy)
      setPending(p => ({ ...p, loading: false, detected: res.detected, input: res.detected ?? '' }))
    } catch {
      setPending(p => ({ ...p, loading: false, input: '' }))
    }
  }

  const confirm = () => {
    if (!pending) return
    const num = pending.input.trim()
    if (/^\d{1,3}$/.test(num)) {
      onAdd({ part_number: num, pos_x: pending.cx, pos_y: pending.cy })
    }
    setPending(null)
  }

  return (
    <div
      onClick={handleClick}
      style={{ position: 'absolute', inset: 0, cursor: 'crosshair', zIndex: 10 }}
    >
      {pending && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: 'absolute',
            left: pending.px,
            top: pending.py,
            transform: 'translate(-50%, -110%)',
            background: '#1e1b4b',
            border: '2px solid #8b5cf6',
            borderRadius: 8,
            padding: '6px 10px',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            zIndex: 20,
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            minWidth: 140,
          }}
        >
          {pending.loading
            ? <span style={{ color: '#a78bfa', fontSize: 12 }}>OCR en cours…</span>
            : <>
                <span style={{ color: '#a78bfa', fontSize: 11 }}>Repère :</span>
                <input
                  autoFocus
                  value={pending.input}
                  onChange={e => setPending(p => ({ ...p, input: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') setPending(null) }}
                  style={{ width: 44, fontSize: 13, fontWeight: 'bold', textAlign: 'center', border: '1px solid #8b5cf6', borderRadius: 4, padding: '2px 4px', background: '#312e81', color: '#fff' }}
                />
                <button onClick={confirm} style={{ background: '#8b5cf6', color: '#fff', border: 'none', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 12 }}>OK</button>
                <button onClick={() => setPending(null)} style={{ background: 'none', color: '#a78bfa', border: 'none', cursor: 'pointer', fontSize: 14, padding: '0 2px' }}>✕</button>
              </>
          }
          {/* Indicateur si OCR a trouvé ou non */}
          {!pending.loading && pending.detected !== undefined && (
            <span style={{ position: 'absolute', top: -18, left: 0, fontSize: 10, color: pending.detected ? '#10b981' : '#f59e0b', whiteSpace: 'nowrap' }}>
              {pending.detected ? `OCR : ${pending.detected}` : 'Non détecté — saisir manuellement'}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

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
  const [refsVues, setRefsVues] = useState([])
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

  // Édition titre / numéro de page
  const [metaDraft, setMetaDraft] = useState({ titre: '', numero: '' })
  const [savingMeta, setSavingMeta] = useState(false)
  const [extractingMeta, setExtractingMeta] = useState(false)
  const [metaMsg, setMetaMsg] = useState(null)
  const [metaStatus, setMetaStatus] = useState(null)

  // Sélection multiple nomenclature
  const [selectedNomencIds, setSelectedNomencIds] = useState(new Set())

  const toggleNomencSelect = (id, checked) =>
    setSelectedNomencIds(s => { const n = new Set(s); checked ? n.add(id) : n.delete(id); return n })

  const toggleNomencAll = (checked) =>
    setSelectedNomencIds(checked ? new Set(refs.map(r => r.id)) : new Set())

  const bulkCorrige = async (corrige) => {
    const ids = [...selectedNomencIds]
    const updated = await api.bulkCorrigeNomenclature(ids, corrige)
    setRefs(rs => rs.map(r => { const u = updated.find(x => x.id === r.id); return u ?? r }))
    setSelectedNomencIds(new Set())
  }

  // Détection refs vues (schéma)
  const [rerunningVues, setRerunningVues] = useState(false)
  const [vuesMsg, setVuesMsg] = useState(null)
  const [showReperes, setShowReperes] = useState(false)

  useEffect(() => {
    api.getPage(id).then(pg => {
      setPage(pg)
      setPendingBboxes(normalizeBboxes(pg))
      setMetaDraft({ titre: pg.titre || '', numero: pg.numero ?? '' })
      const refsPromise = pg.has_nomenclature
        ? api.getPageNomenclature(id)
        : api.getPageRefs(id)
      return Promise.all([refsPromise, api.getPageBlocs(id), api.getCatalogue(pg.id_catalogue), api.getPageRefsVues(id)])
    })
      .then(([rs, bs, cat, rv]) => { setRefs(rs); setBlocs(bs); setCatalogue(cat); setRefsVues(rv) })
      .finally(() => setLoading(false))
  }, [id])

  // Mesurer l'image quand on entre en mode édition bbox ou repères
  useEffect(() => {
    if (!editBbox && !showReperes) return
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
  }, [editBbox, showReperes])

  const changeType = async (newType) => {
    setSavingType(true)
    try {
      const updated = await api.patchPage(id, { type: newType || null })
      setPage(p => ({ ...p, type: updated.type, has_nomenclature: updated.has_nomenclature }))
    } finally {
      setSavingType(false)
    }
  }

  const saveMeta = async () => {
    setSavingMeta(true)
    setMetaMsg(null)
    try {
      const body = {}
      if (metaDraft.titre !== (page.titre || '')) body.titre = metaDraft.titre || null
      if (String(metaDraft.numero) !== String(page.numero ?? '')) body.numero = metaDraft.numero !== '' ? Number(metaDraft.numero) : null
      if (!Object.keys(body).length) return
      const updated = await api.patchPage(id, body)
      setPage(p => ({ ...p, titre: updated.titre, numero: updated.numero }))
      setMetaMsg('Enregistré')
      setMetaStatus('success')
    } catch (e) {
      setMetaMsg(e.message)
      setMetaStatus('error')
    } finally {
      setSavingMeta(false)
    }
  }

  const extractMeta = async () => {
    if (!catalogue?.column_template?.title_bbox && !catalogue?.column_template?.page_number_bbox) {
      setMetaMsg('Aucune zone de détection définie dans le gabarit du catalogue.')
      setMetaStatus('error')
      return
    }
    setExtractingMeta(true)
    setMetaMsg(null)
    try {
      const result = await api.extractPageMeta(id)
      if (result.error) throw new Error(result.error)
      setPage(p => ({ ...p, titre: result.titre, numero: result.numero }))
      setMetaDraft({ titre: result.titre || '', numero: result.numero ?? '' })
      setMetaMsg(`Titre : "${result.titre || '—'}" · Numéro : ${result.numero ?? '—'}`)
      setMetaStatus('success')
    } catch (e) {
      setMetaMsg(e.message)
      setMetaStatus('error')
    } finally {
      setExtractingMeta(false)
    }
  }

  const rerunVues = async () => {
    setRerunningVues(true)
    setVuesMsg(null)
    try {
      const result = await api.rerunVues(id)
      if (result.error) throw new Error(result.error)
      setVuesMsg(`${result.inserted} référence(s) détectée(s)`)
      const rv = await api.getPageRefsVues(id)
      setRefsVues(rv)
    } catch (e) {
      setVuesMsg(`Erreur : ${e.message}`)
    } finally {
      setRerunningVues(false)
    }
  }

  const addRepere = async ({ part_number, pos_x, pos_y }) => {
    const r = await api.addRefVue(id, { part_number, pos_x, pos_y })
    setRefsVues(prev => [...prev, r].sort((a, b) => parseInt(a.part_number) - parseInt(b.part_number)))
  }

  const addLiaison = async (repere, nomenclatureId) => {
    if (!nomenclatureId) return
    const nomenc = refs.find(r => r.id === parseInt(nomenclatureId))
    if (!nomenc) return
    if (repere.liaisons?.some(l => l.nomenclature_id === parseInt(nomenclatureId))) return
    await api.addRefVueLiaison(repere.id, parseInt(nomenclatureId))
    setRefsVues(prev => prev.map(r => r.id === repere.id ? {
      ...r,
      liaisons: [...(r.liaisons ?? []), { nomenclature_id: nomenc.id, join_type: 'manual', part_number: nomenc.part_number, ref_no: nomenc.ref_no, description: nomenc.description }],
    } : r))
  }

  const removeLiaison = async (repere, nomenclatureId) => {
    await api.deleteRefVueLiaison(repere.id, nomenclatureId)
    setRefsVues(prev => prev.map(r => r.id === repere.id ? {
      ...r,
      liaisons: r.liaisons.filter(l => l.nomenclature_id !== nomenclatureId),
    } : r))
  }

  const deleteRepere = async (r) => {
    if (!window.confirm(`Supprimer le repère ${r.part_number} ?`)) return
    await api.deleteRefVue(r.id)
    setRefsVues(prev => prev.filter(x => x.id !== r.id))
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
        <Link
          to={`/page/${id}`}
          title="Voir la page publique"
          style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '.3rem', fontSize: '.8rem', color: 'var(--text-muted, #888)', textDecoration: 'none' }}
        >
          <Eye size={13} />
          Vue publique
        </Link>
      </div>

      {/* Ligne titre + actions sur une seule ligne */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', minWidth: 0 }}>
        {/* Titre inline éditable — prend tout l'espace dispo */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.3rem', flex: 1, minWidth: 0, overflow: 'hidden' }}>
          {(catalogue?.column_template?.title_bbox || catalogue?.column_template?.page_number_bbox) && (
            <button
              className="or-btn or-btn-ghost"
              onClick={extractMeta}
              disabled={extractingMeta}
              title="Détecter titre et numéro depuis le gabarit"
              style={{ flexShrink: 0, alignSelf: 'center', padding: '0 4px', lineHeight: 1 }}
            >
              <ScanSearch size={24} />
            </button>
          )}
          <span className="or-page-title" style={{ color: 'var(--text-muted)', fontWeight: 400, flexShrink: 0 }}>Page</span>
          <input
            className="or-input-inline"
            type="text"
            inputMode="numeric"
            value={metaDraft.numero}
            onChange={e => setMetaDraft(d => ({ ...d, numero: e.target.value }))}
            onBlur={saveMeta}
            onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
            placeholder="—"
            style={{ width: `${Math.max(2.4, (String(metaDraft.numero).length || 1) + 0.4)}ch`, fontWeight: 700, fontSize: '1.5rem', flexShrink: 0 }}
          />
          <span className="or-page-title" style={{ color: 'var(--text-muted)', fontWeight: 400, flexShrink: 0 }}>—</span>
          <input
            className="or-input-inline"
            value={metaDraft.titre}
            onChange={e => setMetaDraft(d => ({ ...d, titre: e.target.value }))}
            onBlur={saveMeta}
            onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
            placeholder="(sans titre)"
            style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: '1.5rem' }}
          />
          {savingMeta && <span style={{ fontSize: '.8rem', color: 'var(--text-muted)', flexShrink: 0 }}>…</span>}
          {!savingMeta && metaMsg && (
            <span style={{ fontSize: '.8rem', flexShrink: 0, color: metaStatus === 'success' ? '#15803d' : '#dc2626' }}>
              {metaStatus === 'success' ? '✓' : metaMsg}
            </span>
          )}
        </div>

        {/* Contrôles fixes à droite */}
        <select
          className="or-select"
          value={page.type || ''}
          onChange={e => changeType(e.target.value)}
          disabled={savingType}
          style={{ fontSize: '.8rem', flexShrink: 0, width: 'auto' }}
        >
          <option value="">— type —</option>
          <option value="cover">Couverture</option>
          <option value="index">Index</option>
          <option value="schema">Schéma</option>
          <option value="parts_list">Liste de pièces</option>
          <option value="view_only">Vue éclatée</option>
          <option value="mixed">Mixte</option>
        </select>
        <span style={{ fontSize: '.85rem', color: 'var(--text-muted)', flexShrink: 0, whiteSpace: 'nowrap' }}>{corriges} / {nb} corrigées</span>
        {canHaveNomenclature && (
          <button
            className={`or-btn or-btn-sm ${editBbox ? 'or-btn-warning' : 'or-btn-secondary'}`}
            onClick={() => { setEditBbox(e => !e); setRerunMsg(null); setRerunStatus(null) }}
            style={{ flexShrink: 0 }}
          >
            {editBbox ? <X size={14} /> : <Square size={14} />}
            <span>{editBbox ? 'Fermer' : 'Zones nomenclature'}</span>
          </button>
        )}
        <label style={{ fontSize: '.85rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={showBlocs} onChange={e => setShowBlocs(e.target.checked)} />
          Blocs OCR ({blocs.length})
        </label>
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
              refsVues={refsVues}
              blocs={showBlocs ? blocs : []}
              showNomenclature={!editBbox}
              columnTemplate={catalogue?.column_template}
              selectedNomencId={null}
              selectedRepereId={null}
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
            {/* Mode placement repères : clic → OCR local → popup confirmation */}
            {showReperes && !editBbox && (
              <ReperesOverlay
                pageId={id}
                naturalSize={naturalSize}
                displaySize={displaySize}
                onAdd={addRepere}
              />
            )}
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
            <>
              {selectedNomencIds.size > 0 && (
                <div className="or-flex or-gap-2" style={{ marginBottom: '0.4rem', alignItems: 'center' }}>
                  <span style={{ fontSize: '.8rem', color: 'var(--text-muted)' }}>{selectedNomencIds.size} sélectionnée(s)</span>
                  <button className="or-btn or-btn-success or-btn-sm" onClick={() => bulkCorrige(true)}>✓ Marquer corrigées</button>
                  <button className="or-btn or-btn-secondary or-btn-sm" onClick={() => bulkCorrige(false)}>Décocher</button>
                </div>
              )}
              <div className="or-box" style={{ padding: 0, overflow: 'hidden' }}>
                <table className="or-table">
                  <thead>
                    <tr>
                      <th style={{ width: 28 }}>
                        <input
                          type="checkbox"
                          checked={selectedNomencIds.size === refs.length && refs.length > 0}
                          ref={el => { if (el) el.indeterminate = selectedNomencIds.size > 0 && selectedNomencIds.size < refs.length }}
                          onChange={e => toggleNomencAll(e.target.checked)}
                        />
                      </th>
                      <th style={{ width: 18 }}></th>
                      <th>Réf.</th>
                      <th>Part Number</th>
                      <th>Description</th>
                      <th>Qté</th>
                      <th>Remarques</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      // nomenclature_id → liste des part_number de repères qui y sont liés
                      const nomencReperes = {}
                      refsVues.forEach(rv => {
                        rv.liaisons?.forEach(l => {
                          if (!nomencReperes[l.nomenclature_id]) nomencReperes[l.nomenclature_id] = []
                          nomencReperes[l.nomenclature_id].push(rv.part_number)
                        })
                      })
                      return refs.map(r => (
                        <NomenclatureRow
                          key={r.id}
                          data={r}
                          reperes={nomencReperes[r.id] ?? []}
                          selected={selectedNomencIds.has(r.id)}
                          onSelect={checked => toggleNomencSelect(r.id, checked)}
                          onUpdated={updated => setRefs(rs => rs.map(x => x.id === updated.id ? updated : x))}
                          onDeleted={delId => setRefs(rs => rs.filter(x => x.id !== delId))}
                        />
                      ))
                    })()}
                  </tbody>
                </table>
              </div>
            </>
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

          {/* Références vues (zone schéma) */}
          <div style={{ marginTop: '1rem' }}>
            <div className="or-flex or-gap-2" style={{ alignItems: 'center', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '.8rem', color: 'var(--text-muted)', fontWeight: 'bold' }}>
                <span style={{ display: 'inline-block', width: 10, height: 10, background: '#8b5cf6', borderRadius: 2, marginRight: 6, verticalAlign: 'middle' }} />
                Repères schéma {refsVues.length > 0 ? `(${refsVues.length})` : ''}
              </span>
              <button
                className={`or-btn or-btn-sm or-btn-secondary ${rerunningVues ? 'is-loading' : ''}`}
                onClick={rerunVues}
                disabled={rerunningVues}
              >
                <RotateCcw size={13} />
                <span>Détecter</span>
              </button>
              <button
                className={`or-btn or-btn-sm ${showReperes ? 'or-btn-primary' : 'or-btn-secondary'}`}
                onClick={() => setShowReperes(s => !s)}
                title="Afficher/masquer les repères sur l'image. Clic sur l'image pour ajouter, clic droit sur un repère pour supprimer."
              >
                {showReperes ? 'Masquer overlay' : 'Overlay schéma'}
              </button>
              {vuesMsg && <span style={{ fontSize: '.8rem', color: 'var(--text-muted)' }}>{vuesMsg}</span>}
            </div>
            {refsVues.length > 0 && (
              <div className="or-box" style={{ padding: 0, overflow: 'hidden' }}>
                <table className="or-table">
                  <thead>
                    <tr>
                      <th>Repère</th>
                      <th>Liaisons nomenclature</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {refsVues.map(r => {
                      const liaisons = r.liaisons ?? []
                      const linkedIds = new Set(liaisons.map(l => l.nomenclature_id))
                      const available = refs.filter(n => !linkedIds.has(n.id))
                      return (
                        <tr key={r.id} style={{ verticalAlign: 'top' }}>
                          <td style={{ paddingTop: '0.6rem' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: liaisons.length > 0 ? '#8b5cf6' : '#6b7280', color: '#fff', borderRadius: '50%', width: 22, height: 22, fontSize: 11, fontWeight: 'bold' }}>
                              {r.part_number}
                            </span>
                          </td>
                          <td>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                              {liaisons.map(l => (
                                <div key={l.nomenclature_id} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '.78rem' }}>
                                  <span style={{ fontSize: '.65rem', padding: '1px 4px', borderRadius: 3, background: l.join_type === 'ref_no' ? '#d1fae5' : l.join_type === 'part_number' ? '#dbeafe' : '#fef3c7', color: l.join_type === 'ref_no' ? '#065f46' : l.join_type === 'part_number' ? '#1e40af' : '#92400e' }}>
                                    {l.join_type === 'ref_no' ? 'ref_no' : l.join_type === 'part_number' ? 'pn' : 'manuel'}
                                  </span>
                                  <span className="or-mono" style={{ fontSize: '.75rem' }}>{l.part_number}</span>
                                  {l.description && <span className="or-muted" style={{ fontSize: '.75rem' }}>— {l.description.slice(0, 35)}{l.description.length > 35 ? '…' : ''}</span>}
                                  <button
                                    className="or-btn or-btn-ghost or-btn-sm or-btn-icon-only"
                                    onClick={() => removeLiaison(r, l.nomenclature_id)}
                                    title="Retirer cette liaison"
                                    style={{ marginLeft: 'auto', opacity: 0.6 }}
                                  >
                                    <X size={11} />
                                  </button>
                                </div>
                              ))}
                              {available.length > 0 && (
                                <select
                                  className="or-select"
                                  style={{ fontSize: '.78rem', width: '100%', opacity: 0.7 }}
                                  value=""
                                  onChange={e => { if (e.target.value) addLiaison(r, e.target.value) }}
                                >
                                  <option value="">+ Lier une nomenclature…</option>
                                  {available.map(n => (
                                    <option key={n.id} value={n.id}>
                                      {n.ref_no ? `#${n.ref_no} · ` : ''}{n.part_number}{n.description ? ` — ${n.description.slice(0, 40)}` : ''}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>
                          </td>
                          <td style={{ paddingTop: '0.6rem' }}>
                            <button className="or-btn or-btn-ghost or-btn-sm or-btn-icon-only" onClick={() => deleteRepere(r)} title="Supprimer le repère">
                              <X size={12} />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
