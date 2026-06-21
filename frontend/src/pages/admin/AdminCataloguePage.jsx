import { useEffect, useRef, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { api } from '../../api/client'
import ColumnTemplateBuilder from '../../components/ColumnTemplateBuilder'
import BboxEditor from '../../components/BboxEditor'

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
  const [rerunProgress, setRerunProgress] = useState(null)
  const [selectedPageId, setSelectedPageId] = useState(null)
  const [pendingBboxes, setPendingBboxes] = useState([])   // [{name,x1,y1,x2,y2}, ...]
  const [committedBboxes, setCommittedBboxes] = useState([])
  const [activeBboxIdx, setActiveBboxIdx] = useState(0)    // index de la bbox sélectionnée dans le builder
  const [displaySize, setDisplaySize] = useState(null)
  const [naturalSize, setNaturalSize] = useState(null)
  const [savingBbox, setSavingBbox] = useState(false)

  // Édition type de page inline
  const [editingTypeId, setEditingTypeId] = useState(null)

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

  if (loading) return <progress className="progress is-info" />

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
    setRerunProgress(null)
    try {
      // Convertir dividers en column_template {field: x_abs} utilisable par l'OCR
      const bbox = samplePage?.nomenclature_bbox
      const bboxW = bbox ? bbox.x2 - bbox.x1 : 1000
      const template = buildTemplate(templateDraft, bbox)
      await api.patchCatalogue(id, { column_template: template })
      setCatalogue(c => ({ ...c, column_template: template }))

      // Relancer l'OCR via SSE
      const url = api.rerunCatalogueNomenclature(id)
      const evs = new EventSource(url)
      let done = 0, total = 0
      evs.onmessage = (e) => {
        const data = JSON.parse(e.data)
        if (data.type === 'start') { total = data.total; setRerunProgress({ done: 0, total }) }
        if (data.type === 'page_done') { done++; setRerunProgress({ done, total }) }
        if (data.type === 'done') {
          evs.close()
          setRerunMsg(`✅ OCR terminé — ${done} pages traitées`)
          setSavingTemplate(false)
          setShowTemplateBuilder(false)
          // Recharger les pages
          api.getCataloguePages(id).then(setPages)
        }
        if (data.type === 'error') {
          evs.close()
          setRerunMsg(`❌ Erreur: ${data.msg}`)
          setSavingTemplate(false)
        }
      }
      evs.onerror = () => {
        evs.close()
        setRerunMsg('❌ Connexion perdue')
        setSavingTemplate(false)
      }
    } catch (e) {
      setRerunMsg(`❌ ${e.message}`)
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
      <nav className="breadcrumb"><ul>
        <li><Link to="/catalogues">Catalogues</Link></li>
        <li className="is-active"><a>Admin — {catalogue?.name}</a></li>
      </ul></nav>

      <div className="is-flex is-align-items-center is-justify-content-space-between mb-3">
        <h1 className="title mb-0">Correction OCR — {catalogue?.name}</h1>
        <div className="is-flex" style={{ gap: 8 }}>
          <button
            className="button is-info is-light is-small"
            onClick={() => { setShowAddPages(s => !s); setAddError(null) }}
          >
            {showAddPages ? '✕ Annuler' : '+ Ajouter des pages'}
          </button>
          {samplePage && (
            <button
              className={`button is-warning is-light is-small ${showTemplateBuilder ? 'is-warning' : ''}`}
              onClick={() => { setShowTemplateBuilder(s => !s); setRerunMsg(null) }}
            >
              {showTemplateBuilder ? '✕ Fermer le gabarit' : '📐 Gabarit colonnes'}
            </button>
          )}
        </div>
      </div>

      {/* Import pages supplémentaires */}
      {showAddPages && (
        <div className="box mb-4">
          <h2 className="subtitle is-6 mb-3">Ajouter des pages au catalogue</h2>
          <form onSubmit={startAddPages}>
            <div className="field">
              <label className="label">Fichier PDF ou image</label>
              <input
                ref={addFileRef}
                className="input"
                type="file"
                accept=".pdf,image/*"
                onChange={e => setAddFile(e.target.files[0])}
              />
            </div>
            {addError && <div className="notification is-danger is-light py-2 px-3">{addError}</div>}
            <button
              className={`button is-info ${addImporting ? 'is-loading' : ''}`}
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
        <div className="box mb-4" style={{ background: '#1a1a2e', border: '1px solid #374151' }}>
          <h2 className="subtitle is-6 has-text-white mb-3">
            Définir le gabarit de colonnes
            <span className="is-size-7 has-text-grey ml-2">— page {samplePage.numero}</span>
          </h2>

          {catalogue?.column_template && (
            <p className="is-size-7 has-text-warning mb-2">
              Gabarit existant : {Object.entries(catalogue.column_template).map(([k, v]) => `${k}=${v}`).join(', ')}
            </p>
          )}

          {/* Sélecteur de page par miniatures */}
          <div className="mb-3">
            <p className="is-size-7 has-text-grey mb-2">Page de référence ({nomenclaturePages.length} pages avec nomenclature) :</p>
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
              <p className="is-size-7 has-text-grey mb-1">
                Dessinez les zones de nomenclature sur la page, puis définissez les colonnes à droite.
              </p>

              {/* Onglets des zones */}
              <div className="is-flex is-align-items-center mb-2" style={{ gap: 6, flexWrap: 'wrap' }}>
                {pendingBboxes.map((b, i) => (
                  <div key={i} className="is-flex is-align-items-center" style={{ gap: 2 }}>
                    <button
                      className={`button is-small ${activeBboxIdx === i ? 'is-warning' : 'is-light'}`}
                      onClick={() => setActiveBboxIdx(i)}
                    >
                      {b.name || `Zone ${i + 1}`}
                    </button>
                    {pendingBboxes.length > 1 && (
                      <button
                        className="button is-small is-danger is-light"
                        onClick={() => removeBbox(i)}
                        title="Supprimer cette zone"
                      >✕</button>
                    )}
                  </div>
                ))}
                <button className="button is-small is-info is-light" onClick={addBbox} title="Ajouter une zone">
                  + Zone
                </button>
              </div>

              {/* Nom de la zone active */}
              {pendingBboxes[activeBboxIdx] && (
                <div className="mb-2">
                  <input
                    className="input is-small"
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
                {/* Un BboxEditor par zone, seule la zone active est interactive */}
                {displaySize && naturalSize && pendingBboxes.map((b, i) => (
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

              <div className="mt-2 is-flex is-align-items-center" style={{ gap: 8 }}>
                <button
                  className={`button is-warning is-small ${savingBbox ? 'is-loading' : ''}`}
                  onClick={saveBboxes}
                  disabled={savingBbox || pendingBboxes.length === 0}
                >
                  Sauvegarder les zones
                </button>
                {pendingBboxes[activeBboxIdx] && (
                  <span className="is-size-7 has-text-grey">
                    {pendingBboxes[activeBboxIdx].x1},{pendingBboxes[activeBboxIdx].y1} → {pendingBboxes[activeBboxIdx].x2},{pendingBboxes[activeBboxIdx].y2}
                  </span>
                )}
              </div>
            </div>

            {/* Colonne droite : builder sur le crop de la zone active */}
            <div className="column is-half">
              <p className="is-size-7 has-text-grey mb-1">
                Cliquez sur le crop pour ajouter des séparateurs de colonnes.
              </p>
              {committedBboxes[activeBboxIdx] && (
                <ColumnTemplateBuilder
                  key={`${samplePage?.id}-${activeBboxIdx}-${JSON.stringify(committedBboxes[activeBboxIdx])}`}
                  page={{ ...samplePage, nomenclature_bbox: committedBboxes[activeBboxIdx] }}
                  imageW={naturalSize?.w || 2550}
                  imageH={naturalSize?.h || 3300}
                  onChange={setTemplateDraft}
                />
              )}
            </div>
          </div>

          {rerunMsg && (
            <div className={`notification is-size-7 py-2 px-3 mt-3 ${rerunMsg.startsWith('✅') ? 'is-success is-light' : 'is-danger is-light'}`}>
              {rerunMsg}
            </div>
          )}

          {rerunProgress && (
            <div className="mt-2">
              <p className="is-size-7 has-text-grey mb-1">{rerunProgress.done} / {rerunProgress.total} pages traitées</p>
              <progress className="progress is-info is-small" value={rerunProgress.done} max={rerunProgress.total} />
            </div>
          )}

          <div className="mt-3 is-flex" style={{ gap: 8 }}>
            <button
              className={`button is-primary is-small ${savingTemplate ? 'is-loading' : ''}`}
              onClick={saveAndRerun}
              disabled={savingTemplate || !templateDraft}
            >
              Sauvegarder et relancer l'OCR sur tout le catalogue
            </button>
            <button className="button is-light is-small" onClick={() => setShowTemplateBuilder(false)}>
              Annuler
            </button>
          </div>
        </div>
      )}

      <div className="box mb-4">
        <p className="mb-2">{totalCorr} / {totalRefs} références corrigées ({pct}%)</p>
        <progress className="progress is-success" value={pct} max={100}>{pct}%</progress>
      </div>

      <div className="tabs mb-4">
        <ul>
          {[['all', 'Toutes'], ['uncorrected', 'À corriger'], ['corrected', 'Corrigées']].map(([v, l]) => (
            <li key={v} className={filter === v ? 'is-active' : ''}>
              <a onClick={() => setFilter(v)}>{l}</a>
            </li>
          ))}
        </ul>
      </div>

      <table className="table is-fullwidth is-hoverable">
        <thead>
          <tr><th>Page</th><th>Titre</th><th>Type</th><th>Refs</th><th>Corrigées</th><th></th></tr>
        </thead>
        <tbody>
          {filtered.map(p => (
            <tr key={p.id}>
              <td>{p.numero}</td>
              <td>{p.titre}</td>
              <td>
                {editingTypeId === p.id ? (
                  <div className="select is-small">
                    <select
                      autoFocus
                      value={p.type || ''}
                      onChange={e => changePageType(p.id, e.target.value)}
                      onBlur={() => setEditingTypeId(null)}
                    >
                      <option value="">— type —</option>
                      <option value="cover">Couverture</option>
                      <option value="index">Index</option>
                      <option value="schema">Schéma</option>
                      <option value="parts_list">Liste de pièces</option>
                      <option value="view_only">Vue éclatée</option>
                      <option value="mixed">Mixte</option>
                    </select>
                  </div>
                ) : (
                  <span
                    className="tag is-light"
                    style={{ cursor: 'pointer' }}
                    title="Cliquer pour modifier le type"
                    onClick={() => setEditingTypeId(p.id)}
                  >
                    {p.type || '—'}
                  </span>
                )}
              </td>
              <td>{p.nb_refs}</td>
              <td>
                <span className={p.nb_corriges === p.nb_refs && p.nb_refs > 0 ? 'has-text-success' : 'has-text-warning'}>
                  {p.nb_corriges}
                </span>
              </td>
              <td>
                <Link to={`/admin/page/${p.id}/edit`} className="button is-small is-info is-light">
                  Éditer
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Convertit le draft du builder en column_template stockable.
 * Format: { part_number: x_right, qty: x_right, description: x_right }
 * où x_right est la position absolue dans l'image (bord droit de la colonne).
 * Les zones sont triées par position.
 */
function buildTemplate(draft, bbox) {
  if (!draft || !bbox) return null
  const bboxX1 = bbox.x1
  const bboxW = bbox.x2 - bbox.x1

  // draft.zones[i] contient le rôle de la zone i
  // draft.dividers[i] = { x_rel, role } où role est le rôle de la zone À DROITE du trait
  // zones = [zone0, zone1, ...] (length = dividers.length + 1)
  // boundaries = [0, div[0].x_rel, div[1].x_rel, ..., 1]
  const { dividers, zones } = draft
  const boundaries = [0, ...dividers.map(d => d.x_rel), 1]

  const template = {}
  zones.forEach((zone, i) => {
    if (!zone || zone.role === 'ignore') return
    // Bord droit de cette zone = boundaries[i+1] en absolu
    const x_right_rel = boundaries[i + 1]
    const x_right_abs = Math.round(bboxX1 + x_right_rel * bboxW)
    if (!template[zone.role] || x_right_abs > template[zone.role]) {
      template[zone.role] = x_right_abs
    }
  })

  return template
}
