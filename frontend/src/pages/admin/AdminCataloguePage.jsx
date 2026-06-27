import { useEffect, useRef, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { api } from '../../api/client'
import ColumnTemplateBuilder from '../../components/ColumnTemplateBuilder'
import BboxEditor from '../../components/BboxEditor'
import {
  X, FilePlus, TableProperties, Plus, Save, RotateCcw,
  CheckCircle, AlertCircle, Pencil, ChevronRight, PenSquare
} from 'lucide-react'

function FullPageImage({ src, alt, onMeasure }) {
  const imgRef = useRef(null)
  useEffect(() => {
    const el = imgRef.current
    if (!el) return
    const measure = () => onMeasure(
      { w: el.naturalWidth, h: el.naturalHeight },
      { w: el.offsetWidth, h: el.offsetHeight }
    )
    if (el.complete && el.naturalWidth) measure()
    el.addEventListener('load', measure)
    window.addEventListener('resize', measure)
    return () => {
      el.removeEventListener('load', measure)
      window.removeEventListener('resize', measure)
    }
  }, [src])
  return <img ref={imgRef} src={src} alt={alt} style={{ width: '100%', display: 'block' }} draggable={false} />
}

export default function AdminCataloguePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [catalogue, setCatalogue] = useState(null)
  const [pages, setPages] = useState([])
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)

  // Gabarit colonnes
  const [showTemplateBuilder, setShowTemplateBuilder] = useState(false)
  const [templateDraft, setTemplateDraft] = useState(null)
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [rerunMsg, setRerunMsg] = useState(null)
  const [rerunStatus, setRerunStatus] = useState(null) // 'success' | 'error'
  const [rerunProgress, setRerunProgress] = useState(null)
  const [selectedPageId, setSelectedPageId] = useState(null)
  const [pendingBboxes, setPendingBboxes] = useState([])   // [{name,x1,y1,x2,y2}, ...]
  const [committedBboxes, setCommittedBboxes] = useState([])
  const [activeBboxIdx, setActiveBboxIdx] = useState(0)    // index de la bbox sélectionnée dans le builder
  const [displaySize, setDisplaySize] = useState(null)
  const [naturalSize, setNaturalSize] = useState(null)
  const [savingBbox, setSavingBbox] = useState(false)
  // Zones titre, numéro de page et schéma (coordonnées en pixels naturels)
  const [titleBbox, setTitleBbox] = useState(null)
  const [pageNumBbox, setPageNumBbox] = useState(null)
  const [schemaBbox, setSchemaBbox] = useState(null)
  // Quel éditeur de zone méta est actif : null | 'title' | 'page_number' | 'schema'
  const [activeMetaZone, setActiveMetaZone] = useState(null)

  // Édition inline des pages dans la table
  const [editingTypeId, setEditingTypeId] = useState(null)
  const [pageDrafts, setPageDrafts] = useState({})

  const getPageDraft = (p) => pageDrafts[p.id] ?? { numero: p.numero ?? '', titre: p.titre ?? '' }

  const setPageDraftField = (pageId, field, value) =>
    setPageDrafts(d => ({ ...d, [pageId]: { ...getPageDraft({ id: pageId }), [field]: value } }))

  const savePageMeta = async (p) => {
    const draft = getPageDraft(p)
    const body = {}
    if (String(draft.numero) !== String(p.numero ?? '')) body.numero = draft.numero !== '' ? Number(draft.numero) : null
    if (draft.titre !== (p.titre ?? '')) body.titre = draft.titre || null
    if (!Object.keys(body).length) return
    const updated = await api.patchPage(p.id, body)
    setPages(ps => ps.map(pg => pg.id === p.id ? { ...pg, titre: updated.titre, numero: updated.numero } : pg))
  }

  const changePageType = async (pageId, newType) => {
    await api.patchPage(pageId, { type: newType || null })
    setPages(ps => ps.map(p => p.id === pageId ? { ...p, type: newType || null } : p))
    setEditingTypeId(null)
  }

  // Import pages supplémentaires
  const [showAddPages, setShowAddPages] = useState(false)
  const [addFile, setAddFile] = useState(null)
  const [addImporting, setAddImporting] = useState(false)
  const [addError, setAddError] = useState(null)
  const addFileRef = useRef(null)

  useEffect(() => {
    Promise.all([api.getCatalogue(id), api.getCataloguePages(id)])
      .then(([cat, pgs]) => { setCatalogue(cat); setPages(pgs) })
      .finally(() => setLoading(false))
  }, [id])

  // Pages disponibles pour le builder (avec nomenclature)
  const nomenclaturePages = pages.filter(p => p.has_nomenclature && (p.nomenclature_bboxes?.length || p.nomenclature_bbox))
  const samplePage = selectedPageId
    ? nomenclaturePages.find(p => p.id === selectedPageId) ?? nomenclaturePages[0]
    : nomenclaturePages[0]

  // Normalise les bboxes d'une page en tableau nommé
  const normalizeBboxes = (p) => {
    if (!p) return []
    if (p.nomenclature_bboxes?.length) return p.nomenclature_bboxes
    if (p.nomenclature_bbox) return [{ name: 'Nomenclature', ...p.nomenclature_bbox }]
    return []
  }

  // Initialiser les bboxes quand samplePage change — DOIT être avant tout return conditionnel
  useEffect(() => {
    if (samplePage) {
      const bboxes = normalizeBboxes(samplePage)
      setPendingBboxes(bboxes)
      setCommittedBboxes(bboxes)
      setActiveBboxIdx(0)
    }
  }, [samplePage?.id])

  if (loading) return <progress className="or-progress" />

  const filtered = pages.filter(p => {
    if (filter === 'uncorrected') return p.nb_refs > 0 && p.nb_corriges < p.nb_refs
    if (filter === 'corrected') return p.nb_refs > 0 && p.nb_corriges === p.nb_refs
    return true
  })

  const totalRefs = pages.reduce((s, p) => s + p.nb_refs, 0)
  const totalCorr = pages.reduce((s, p) => s + p.nb_corriges, 0)
  const pct = totalRefs > 0 ? Math.round((totalCorr / totalRefs) * 100) : 0

  const selectPage = (p) => {
    setSelectedPageId(p.id)
    setDisplaySize(null)
    setNaturalSize(null)
    setActiveBboxIdx(0)
  }

  const addBbox = () => {
    const w = naturalSize?.w || 2550
    const h = naturalSize?.h || 3300
    const newBbox = {
      name: `Zone ${pendingBboxes.length + 1}`,
      x1: Math.round(w * 0.1),
      y1: Math.round(h * 0.3),
      x2: Math.round(w * 0.9),
      y2: Math.round(h * 0.6),
    }
    const updated = [...pendingBboxes, newBbox]
    setPendingBboxes(updated)
    setActiveBboxIdx(updated.length - 1)
  }

  const removeBbox = (idx) => {
    const updated = pendingBboxes.filter((_, i) => i !== idx)
    setPendingBboxes(updated)
    setActiveBboxIdx(Math.min(activeBboxIdx, updated.length - 1))
  }

  const updateBboxAt = (idx, bbox) => {
    setPendingBboxes(prev => prev.map((b, i) => i === idx ? { ...b, ...bbox } : b))
  }

  const renameBboxAt = (idx, name) => {
    setPendingBboxes(prev => prev.map((b, i) => i === idx ? { ...b, name } : b))
  }

  const saveBboxes = async () => {
    if (!samplePage) return
    setSavingBbox(true)
    try {
      await api.patchPage(samplePage.id, { nomenclature_bboxes: pendingBboxes })
      setPages(ps => ps.map(p => p.id === samplePage.id ? { ...p, nomenclature_bboxes: pendingBboxes } : p))
      setCommittedBboxes(pendingBboxes)
    } finally {
      setSavingBbox(false)
    }
  }

  const saveAndRerun = async () => {
    if (!templateDraft) return
    setSavingTemplate(true)
    setRerunMsg(null)
    setRerunStatus(null)
    setRerunProgress(null)
    try {
      const bbox = samplePage?.nomenclature_bbox
      const template = buildTemplate(templateDraft, bbox, titleBbox, pageNumBbox, schemaBbox)
      await api.patchCatalogue(id, { column_template: template })
      setCatalogue(c => ({ ...c, column_template: template }))

      const url = api.rerunCatalogueNomenclature(id)
      const evs = new EventSource(url)
      let done = 0, total = 0
      evs.onmessage = (e) => {
        const data = JSON.parse(e.data)
        if (data.type === 'start') { total = data.total; setRerunProgress({ done: 0, total }) }
        if (data.type === 'page_done') { done++; setRerunProgress({ done, total }) }
        if (data.type === 'done') {
          evs.close()
          setRerunMsg(`OCR terminé — ${done} pages traitées`)
          setRerunStatus('success')
          setSavingTemplate(false)
          setShowTemplateBuilder(false)
          api.getCataloguePages(id).then(setPages)
        }
        if (data.type === 'error') {
          evs.close()
          setRerunMsg(`Erreur: ${data.msg}`)
          setRerunStatus('error')
          setSavingTemplate(false)
        }
      }
      evs.onerror = () => {
        evs.close()
        setRerunMsg('Connexion perdue')
        setRerunStatus('error')
        setSavingTemplate(false)
      }
    } catch (e) {
      setRerunMsg(e.message)
      setRerunStatus('error')
      setSavingTemplate(false)
    }
  }

  const startAddPages = async e => {
    e.preventDefault()
    if (!addFile) return setAddError('Sélectionnez un fichier')
    setAddError(null)
    setAddImporting(true)

    const data = new FormData()
    data.append('file', addFile)
    data.append('catalogue_id', id)

    try {
      const res = await fetch('/api/import/pages', { method: 'POST', body: data })
      if (!res.ok) throw new Error(await res.text())
      const { jobId } = await res.json()
      navigate(`/admin/jobs?id=${jobId}`)
    } catch (err) {
      setAddError(err.message)
      setAddImporting(false)
    }
  }

  return (
    <div>
      <div className="or-breadcrumb">
        <Link to="/catalogues">Catalogues</Link>
        <ChevronRight size={12} />
        <span>Admin — {catalogue?.name}</span>
      </div>

      <div className="or-page-header">
        <h1 className="or-page-title">Correction OCR — {catalogue?.name}</h1>
        <div className="or-flex or-gap-2">
          <button
            className={`or-btn or-btn-sm ${showAddPages ? 'or-btn-warning' : 'or-btn-secondary'}`}
            onClick={() => { setShowAddPages(s => !s); setAddError(null) }}
          >
            {showAddPages ? <X size={14} /> : <FilePlus size={14} />}
            <span>{showAddPages ? 'Annuler' : 'Ajouter des pages'}</span>
          </button>
          {samplePage && (
            <button
              className={`or-btn or-btn-sm ${showTemplateBuilder ? 'or-btn-warning' : catalogue?.column_template ? 'or-btn-success' : 'or-btn-secondary'}`}
              onClick={() => {
                setShowTemplateBuilder(s => {
                  if (!s && catalogue?.column_template) {
                    setTitleBbox(catalogue.column_template.title_bbox ?? null)
                    setPageNumBbox(catalogue.column_template.page_number_bbox ?? null)
                    setSchemaBbox(catalogue.column_template.schema_bbox ?? null)
                  }
                  return !s
                })
                setRerunMsg(null)
                setRerunStatus(null)
              }}
            >
              {showTemplateBuilder ? <X size={14} /> : <TableProperties size={14} />}
              <span>
                {showTemplateBuilder
                  ? 'Fermer le gabarit'
                  : catalogue?.column_template
                    ? '✓ Gabarit défini'
                    : 'Gabarit colonnes'}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Import pages supplémentaires */}
      {showAddPages && (
        <div className="or-box" style={{ marginBottom: '1.5rem' }}>
          <h2 className="or-section-title">Ajouter des pages au catalogue</h2>
          <form onSubmit={startAddPages}>
            <div className="field">
              <label className="label">Fichier PDF ou image</label>
              <input
                ref={addFileRef}
                className="or-input"
                type="file"
                accept=".pdf,image/*"
                onChange={e => setAddFile(e.target.files[0])}
              />
            </div>
            {addError && <div className="or-alert or-alert-error">{addError}</div>}
            <button
              className={`or-btn or-btn-primary ${addImporting ? 'is-loading' : ''}`}
              type="submit"
              disabled={addImporting}
            >
              Lancer l'import
            </button>
          </form>
        </div>
      )}

      {/* Gabarit colonnes */}
      {showTemplateBuilder && samplePage && (
        <div className="or-box" style={{ marginBottom: '1.5rem', background: '#1a1a2e', border: '1px solid #374151' }}>
          <h2 className="or-section-title" style={{ color: '#94a3b8' }}>
            Définir le gabarit de colonnes
            <span style={{ fontSize: '.8rem', color: '#6b7280', marginLeft: '0.5rem' }}>— page {samplePage.numero}</span>
          </h2>

          {catalogue?.column_template && (
            <p style={{ fontSize: '.8rem', color: '#a16207', marginBottom: '0.5rem' }}>
              Gabarit existant : {(catalogue.column_template.columns ?? []).map(c => c.role).join(' → ')}
            </p>
          )}

          {/* Sélecteur de page par miniatures */}
          <div className="mb-3">
            <p style={{ fontSize: '.8rem', color: '#6b7280', marginBottom: '0.5rem' }}>Page de référence ({nomenclaturePages.length} pages avec nomenclature) :</p>
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6 }}>
              {nomenclaturePages.map(p => {
                const isSelected = p.id === samplePage?.id
                return (
                  <div
                    key={p.id}
                    onClick={() => selectPage(p)}
                    style={{
                      flexShrink: 0,
                      width: 80,
                      cursor: 'pointer',
                      border: `2px solid ${isSelected ? '#3b82f6' : '#374151'}`,
                      borderRadius: 6,
                      overflow: 'hidden',
                      background: '#111827',
                      opacity: isSelected ? 1 : 0.6,
                      transition: 'opacity 0.15s, border-color 0.15s',
                    }}
                    title={`Page ${p.numero}${p.titre ? ` — ${p.titre}` : ''}`}
                  >
                    {p.thumb
                      ? <img src={p.thumb} alt={`P.${p.numero}`} style={{ width: '100%', display: 'block' }} loading="lazy" />
                      : <div style={{ height: 100, background: '#1f2937' }} />
                    }
                    <div style={{ padding: '2px 4px', textAlign: 'center' }}>
                      <span style={{ fontSize: 10, color: isSelected ? '#60a5fa' : '#9ca3af', fontWeight: isSelected ? 'bold' : 'normal' }}>
                        P.{p.numero}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Deux colonnes : page entière + builder */}
          <div className="columns" style={{ alignItems: 'flex-start' }}>

            {/* Colonne gauche : page entière avec BboxEditors */}
            <div className="column is-half" style={{ position: 'sticky', top: '1rem' }}>
              <p style={{ fontSize: '.8rem', color: '#6b7280', marginBottom: '0.25rem' }}>
                Dessinez les zones de nomenclature sur la page, puis définissez les colonnes à droite.
              </p>

              {/* Onglets des zones */}
              <div className="or-flex or-gap-2" style={{ marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                {pendingBboxes.map((b, i) => (
                  <div key={i} className="or-flex or-gap-2">
                    <button
                      className={`or-btn or-btn-sm ${activeBboxIdx === i ? 'or-btn-warning' : 'or-btn-secondary'}`}
                      onClick={() => setActiveBboxIdx(i)}
                    >
                      {b.name || `Zone ${i + 1}`}
                    </button>
                    {pendingBboxes.length > 1 && (
                      <button
                        className="or-btn or-btn-danger or-btn-sm or-btn-icon-only"
                        onClick={() => removeBbox(i)}
                        title="Supprimer cette zone"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                ))}
                <button className="or-btn or-btn-secondary or-btn-sm" onClick={addBbox} title="Ajouter une zone">
                  <Plus size={14} />
                  <span>Zone</span>
                </button>
              </div>

              {/* Nom de la zone active */}
              {pendingBboxes[activeBboxIdx] && (
                <div className="mb-2">
                  <input
                    className="or-input or-input-sm"
                    value={pendingBboxes[activeBboxIdx].name}
                    onChange={e => renameBboxAt(activeBboxIdx, e.target.value)}
                    placeholder="Nom de la zone"
                    style={{ maxWidth: 200 }}
                  />
                </div>
              )}

              <div style={{ position: 'relative' }}>
                <FullPageImage
                  src={samplePage.image}
                  alt={`Page ${samplePage.numero}`}
                  onMeasure={(nat, disp) => { setNaturalSize(nat); setDisplaySize(disp) }}
                />
                {/* Zones nomenclature — actives quand aucune zone méta n'est sélectionnée */}
                {displaySize && naturalSize && pendingBboxes.map((b, i) => (
                  <BboxEditor
                    key={i}
                    bbox={b}
                    imageW={naturalSize.w}
                    imageH={naturalSize.h}
                    displayW={displaySize.w}
                    displayH={displaySize.h}
                    onChange={i === activeBboxIdx && !activeMetaZone ? (bbox) => updateBboxAt(i, bbox) : () => {}}
                    inactive={i !== activeBboxIdx || !!activeMetaZone}
                  />
                ))}
                {/* Zone titre */}
                {displaySize && naturalSize && titleBbox && (
                  <BboxEditor
                    key="title"
                    bbox={titleBbox}
                    imageW={naturalSize.w}
                    imageH={naturalSize.h}
                    displayW={displaySize.w}
                    displayH={displaySize.h}
                    onChange={activeMetaZone === 'title' ? setTitleBbox : () => {}}
                    inactive={activeMetaZone !== 'title'}
                    color="#f59e0b"
                  />
                )}
                {/* Zone numéro de page */}
                {displaySize && naturalSize && pageNumBbox && (
                  <BboxEditor
                    key="page_number"
                    bbox={pageNumBbox}
                    imageW={naturalSize.w}
                    imageH={naturalSize.h}
                    displayW={displaySize.w}
                    displayH={displaySize.h}
                    onChange={activeMetaZone === 'page_number' ? setPageNumBbox : () => {}}
                    inactive={activeMetaZone !== 'page_number'}
                    color="#10b981"
                  />
                )}
                {/* Zone schéma */}
                {displaySize && naturalSize && schemaBbox && (
                  <BboxEditor
                    key="schema"
                    bbox={schemaBbox}
                    imageW={naturalSize.w}
                    imageH={naturalSize.h}
                    displayW={displaySize.w}
                    displayH={displaySize.h}
                    onChange={activeMetaZone === 'schema' ? setSchemaBbox : () => {}}
                    inactive={activeMetaZone !== 'schema'}
                    color="#8b5cf6"
                  />
                )}
              </div>

              <div className="or-flex or-gap-2" style={{ marginTop: '0.5rem' }}>
                <button
                  className={`or-btn or-btn-warning or-btn-sm ${savingBbox ? 'is-loading' : ''}`}
                  onClick={saveBboxes}
                  disabled={savingBbox || pendingBboxes.length === 0}
                >
                  <Save size={14} />
                  <span>Sauvegarder les zones</span>
                </button>
                {pendingBboxes[activeBboxIdx] && (
                  <span style={{ fontSize: '.8rem', color: '#6b7280' }}>
                    {pendingBboxes[activeBboxIdx].x1},{pendingBboxes[activeBboxIdx].y1} → {pendingBboxes[activeBboxIdx].x2},{pendingBboxes[activeBboxIdx].y2}
                  </span>
                )}
              </div>
            </div>

            {/* Colonne droite : builder sur le crop de la zone active */}
            <div className="column is-half">
              <p style={{ fontSize: '.8rem', color: '#6b7280', marginBottom: '0.25rem' }}>
                Cliquez sur le crop pour ajouter des séparateurs de colonnes.
              </p>
              {committedBboxes[activeBboxIdx] && (
                <ColumnTemplateBuilder
                  key={`${samplePage?.id}-${activeBboxIdx}-${JSON.stringify(committedBboxes[activeBboxIdx])}`}
                  page={{ ...samplePage, nomenclature_bbox: committedBboxes[activeBboxIdx] }}
                  imageW={naturalSize?.w || 2550}
                  imageH={naturalSize?.h || 3300}
                  onChange={setTemplateDraft}
                  initialTemplate={catalogue?.column_template}
                />
              )}
            </div>
          </div>

          {/* Zones titre et numéro de page */}
          <div style={{ borderTop: '1px solid #374151', paddingTop: '1rem', marginTop: '0.5rem' }}>
            <p style={{ fontSize: '.8rem', color: '#94a3b8', marginBottom: '0.5rem', fontWeight: 'bold' }}>
              Zones de détection — titre et numéro de page
            </p>
            <p style={{ fontSize: '.75rem', color: '#6b7280', marginBottom: '0.75rem' }}>
              Définissez où se trouvent le titre et le numéro sur chaque page. L'OCR lira ces zones pour remplir automatiquement les champs correspondants.
            </p>
            <div className="or-flex or-gap-2" style={{ flexWrap: 'wrap' }}>
              {/* Bouton zone titre */}
              <button
                className={`or-btn or-btn-sm ${activeMetaZone === 'title' ? 'or-btn-warning' : titleBbox ? 'or-btn-success' : 'or-btn-secondary'}`}
                onClick={() => {
                  if (activeMetaZone === 'title') {
                    setActiveMetaZone(null)
                  } else {
                    if (!titleBbox && naturalSize) {
                      const w = naturalSize.w, h = naturalSize.h
                      setTitleBbox({ x1: Math.round(w * 0.05), y1: Math.round(h * 0.02), x2: Math.round(w * 0.75), y2: Math.round(h * 0.08) })
                    }
                    setActiveMetaZone('title')
                  }
                }}
              >
                <span style={{ width: 10, height: 10, background: '#f59e0b', borderRadius: 2, display: 'inline-block', marginRight: 4 }} />
                {titleBbox ? '✓ Zone titre' : 'Ajouter zone titre'}
              </button>
              {titleBbox && (
                <button
                  className="or-btn or-btn-ghost or-btn-sm or-btn-icon-only"
                  title="Supprimer zone titre"
                  onClick={() => { setTitleBbox(null); if (activeMetaZone === 'title') setActiveMetaZone(null) }}
                >
                  <X size={12} />
                </button>
              )}

              {/* Bouton zone numéro de page */}
              <button
                className={`or-btn or-btn-sm ${activeMetaZone === 'page_number' ? 'or-btn-warning' : pageNumBbox ? 'or-btn-success' : 'or-btn-secondary'}`}
                onClick={() => {
                  if (activeMetaZone === 'page_number') {
                    setActiveMetaZone(null)
                  } else {
                    if (!pageNumBbox && naturalSize) {
                      const w = naturalSize.w, h = naturalSize.h
                      setPageNumBbox({ x1: Math.round(w * 0.8), y1: Math.round(h * 0.02), x2: Math.round(w * 0.97), y2: Math.round(h * 0.07) })
                    }
                    setActiveMetaZone('page_number')
                  }
                }}
              >
                <span style={{ width: 10, height: 10, background: '#10b981', borderRadius: 2, display: 'inline-block', marginRight: 4 }} />
                {pageNumBbox ? '✓ Zone numéro' : 'Ajouter zone numéro'}
              </button>
              {pageNumBbox && (
                <button
                  className="or-btn or-btn-ghost or-btn-sm or-btn-icon-only"
                  title="Supprimer zone numéro"
                  onClick={() => { setPageNumBbox(null); if (activeMetaZone === 'page_number') setActiveMetaZone(null) }}
                >
                  <X size={12} />
                </button>
              )}

              {/* Bouton zone schéma */}
              <button
                className={`or-btn or-btn-sm ${activeMetaZone === 'schema' ? 'or-btn-warning' : schemaBbox ? 'or-btn-success' : 'or-btn-secondary'}`}
                onClick={() => {
                  if (activeMetaZone === 'schema') {
                    setActiveMetaZone(null)
                  } else {
                    if (!schemaBbox && naturalSize) {
                      const w = naturalSize.w, h = naturalSize.h
                      setSchemaBbox({ x1: Math.round(w * 0.02), y1: Math.round(h * 0.1), x2: Math.round(w * 0.55), y2: Math.round(h * 0.85) })
                    }
                    setActiveMetaZone('schema')
                  }
                }}
              >
                <span style={{ width: 10, height: 10, background: '#8b5cf6', borderRadius: 2, display: 'inline-block', marginRight: 4 }} />
                {schemaBbox ? '✓ Zone schéma' : 'Ajouter zone schéma'}
              </button>
              {schemaBbox && (
                <button
                  className="or-btn or-btn-ghost or-btn-sm or-btn-icon-only"
                  title="Supprimer zone schéma"
                  onClick={() => { setSchemaBbox(null); if (activeMetaZone === 'schema') setActiveMetaZone(null) }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
            {activeMetaZone && (
              <p style={{ fontSize: '.75rem', color: '#f59e0b', marginTop: '0.4rem' }}>
                Faites glisser le cadre {activeMetaZone === 'title' ? 'jaune (titre)' : activeMetaZone === 'page_number' ? 'vert (numéro)' : 'violet (schéma)'} sur la page pour ajuster la zone.
              </p>
            )}
          </div>

          {rerunMsg && (
            <div className={`or-alert ${rerunStatus === 'success' ? 'or-alert-success' : 'or-alert-error'}`} style={{ marginBottom: '1rem' }}>
              {rerunStatus === 'success' ? <CheckCircle size={15} className="or-alert-icon" /> : <AlertCircle size={15} className="or-alert-icon" />}
              {rerunMsg}
            </div>
          )}

          {rerunProgress && (
            <div className="mt-2">
              <p style={{ fontSize: '.8rem', color: '#6b7280', marginBottom: '0.25rem' }}>{rerunProgress.done} / {rerunProgress.total} pages traitées</p>
              <progress className="or-progress" value={rerunProgress.done} max={rerunProgress.total} />
            </div>
          )}

          <div className="or-flex or-gap-2" style={{ marginTop: '1rem' }}>
            <button
              className={`or-btn or-btn-primary or-btn-sm ${savingTemplate ? 'is-loading' : ''}`}
              onClick={saveAndRerun}
              disabled={savingTemplate || !templateDraft}
            >
              <RotateCcw size={14} />
              <span>Sauvegarder et relancer l'OCR sur tout le catalogue</span>
            </button>
            <button className="or-btn or-btn-secondary or-btn-sm" onClick={() => setShowTemplateBuilder(false)}>
              Annuler
            </button>
          </div>
        </div>
      )}

      <div className="or-box" style={{ marginBottom: '1.5rem' }}>
        <p className="mb-2">{totalCorr} / {totalRefs} références corrigées ({pct}%)</p>
        <progress className="or-progress is-success" value={pct} max={100}>{pct}%</progress>
      </div>

      <div className="or-tabs">
        {[['all', 'Toutes'], ['uncorrected', 'À corriger'], ['corrected', 'Corrigées']].map(([v, l]) => (
          <button key={v} className={`or-tab${filter === v ? ' active' : ''}`} onClick={() => setFilter(v)}>{l}</button>
        ))}
      </div>

      <div className="or-box" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="or-table">
          <thead>
            <tr><th>Page</th><th>Titre</th><th>Type</th><th>Refs</th><th>Corrigées</th><th></th></tr>
          </thead>
          <tbody>
            {filtered.map(p => {
              const draft = getPageDraft(p)
              return (
              <tr key={p.id}>
                <td>
                  <input
                    className="or-input-inline"
                    type="text"
                    inputMode="numeric"
                    value={draft.numero}
                    onChange={e => setPageDraftField(p.id, 'numero', e.target.value)}
                    onBlur={() => savePageMeta(p)}
                    onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                    style={{ width: `${Math.max(2, (String(draft.numero).length || 1) + 0.4)}ch`, fontWeight: 600 }}
                  />
                </td>
                <td>
                  <input
                    className="or-input-inline"
                    value={draft.titre}
                    onChange={e => setPageDraftField(p.id, 'titre', e.target.value)}
                    onBlur={() => savePageMeta(p)}
                    onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                    placeholder="(sans titre)"
                    style={{ width: '100%', minWidth: 100 }}
                  />
                </td>
                <td>
                  <select
                    className="or-input-inline"
                    value={p.type || ''}
                    onChange={e => changePageType(p.id, e.target.value)}
                    style={{ width: 'auto', fontSize: '.85rem', cursor: 'pointer' }}
                  >
                    <option value="">—</option>
                    <option value="cover">Couverture</option>
                    <option value="index">Index</option>
                    <option value="schema">Schéma</option>
                    <option value="parts_list">Liste de pièces</option>
                    <option value="view_only">Vue éclatée</option>
                    <option value="mixed">Mixte</option>
                  </select>
                </td>
                <td>{p.nb_refs}</td>
                <td>
                  <span style={{ color: p.nb_corriges === p.nb_refs && p.nb_refs > 0 ? '#15803d' : '#a16207' }}>
                    {p.nb_corriges}
                  </span>
                </td>
                <td>
                  <Link to={`/admin/page/${p.id}/edit`} className="or-btn or-btn-secondary or-btn-sm">
                    <PenSquare size={14} />
                    <span>Éditer</span>
                  </Link>
                </td>
              </tr>
            )})}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * Convertit le draft du builder en column_template stockable.
 * Format: { columns: [{ role, x_rel_right }], bbox_ref: { x1, y1, x2, y2 } }
 * x_rel_right = bord droit de la colonne, relatif à la bbox (0..1).
 * On stocke aussi la bbox de référence pour pouvoir recalculer en absolu si besoin.
 */
function buildTemplate(draft, bbox, titleBbox, pageNumBbox, schemaBbox) {
  if (!draft || !bbox) return null

  const { dividers, zones } = draft
  const boundaries = [0, ...dividers.map(d => d.x_rel), 1]

  const columns = []
  zones.forEach((zone, i) => {
    if (!zone || zone.role === 'ignore') return
    columns.push({
      role: zone.role,
      x_rel_right: boundaries[i + 1],
    })
  })

  return {
    columns,
    bbox_ref: { x1: bbox.x1, y1: bbox.y1, x2: bbox.x2, y2: bbox.y2 },
    ...(titleBbox ? { title_bbox: titleBbox } : {}),
    ...(pageNumBbox ? { page_number_bbox: pageNumBbox } : {}),
    ...(schemaBbox ? { schema_bbox: schemaBbox } : {}),
  }
}
