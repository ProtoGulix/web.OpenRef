import { useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ChevronRight, X, Plus, RefreshCw, Check, AlertCircle, RotateCcw, Move, Edit2 } from 'lucide-react'
import PageViewer from '../../components/PageViewer'
import BboxEditor from '../../components/BboxEditor'
import PageMembresGrid from '../../components/PageMembresGrid'
import ColumnTemplateBuilder from '../../components/ColumnTemplateBuilder'
import NomenclatureRow from '../../components/NomenclatureRow'
import { api } from '../../api/client'

const TABS = [
  { id: 'membres', label: 'Pages membres' },
  { id: 'schema', label: 'Schéma & Zone' },
  { id: 'reperes', label: 'Repères & Jointure' },
  { id: 'nomenclature', label: 'Édition & Nomenclature' },
]

// Overlay clic sur image pour placer un repère (même logique que AdminPageEditPage)
function ReperesOverlay({ pageId, naturalSize, displaySize, schemaBbox, onAdd }) {
  const [pending, setPending] = useState(null)

  if (!naturalSize || !displaySize) return null

  // Quand un crop est actif, displaySize.w correspond à cropW affiché à l'écran
  const cropW = schemaBbox ? schemaBbox.x2 - schemaBbox.x1 : naturalSize.w
  const cropH = schemaBbox ? schemaBbox.y2 - schemaBbox.y1 : naturalSize.h
  const scaleX = displaySize.w / cropW
  const scaleY = displaySize.h / cropH

  const handleClick = async (e) => {
    if (pending) return
    const rect = e.currentTarget.getBoundingClientRect()
    // px/py = position dans le conteneur (zone cropée)
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    // cx/cy = coordonnées dans l'image originale (non cropée)
    const cx = Math.round(px / scaleX + (schemaBbox?.x1 ?? 0))
    const cy = Math.round(py / scaleY + (schemaBbox?.y1 ?? 0))
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
    if (num) onAdd({ part_number: num, pos_x: pending.cx, pos_y: pending.cy })
    setPending(null)
  }

  return (
    <div onClick={handleClick} style={{ position: 'absolute', inset: 0, cursor: 'crosshair', zIndex: 10 }}>
      {pending && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: 'absolute', left: pending.px, top: pending.py,
            transform: 'translate(-50%, -110%)',
            background: '#1e1b4b', border: '2px solid #8b5cf6', borderRadius: 8,
            padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6,
            zIndex: 20, boxShadow: '0 4px 16px rgba(0,0,0,0.4)', minWidth: 140,
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

export default function AdminGroupeEditPage() {
  const { id } = useParams()
  const [groupe, setGroupe] = useState(null)
  const [pages, setPages] = useState([])
  const [refsVues, setRefsVues] = useState([])
  const [tab, setTab] = useState('membres')
  const [loading, setLoading] = useState(true)

  // Titre
  const [titre, setTitre] = useState('')
  const [titreSaved, setTitreSaved] = useState(false)

  // Onglet Schéma — zone bbox
  const [editBbox, setEditBbox] = useState(false)
  const [schemaBbox, setSchemaBbox] = useState(null)
  const [bboxSaving, setBboxSaving] = useState(false)
  const [bboxMsg, setBboxMsg] = useState(null)
  const [naturalSize, setNaturalSize] = useState(null)
  const [displaySize, setDisplaySize] = useState(null)

  // Onglet Repères
  const [showReperes, setShowReperes] = useState(false)
  const [joiningLoad, setJoiningLoad] = useState(false)
  const [jointure, setJointure] = useState(null)
  const [rerunningVues, setRerunningVues] = useState(false)
  const [vuesMsg, setVuesMsg] = useState(null)

  // Onglet Édition & Nomenclature
  const [nomPageId, setNomPageId] = useState(null)
  const [nomBboxes, setNomBboxes] = useState([])          // zones draft (avant validation zonage)
  const [nomActiveBbox, setNomActiveBbox] = useState(0)   // index zone active dans l'éditeur
  const [nomNatSize, setNomNatSize] = useState(null)
  const [nomDispSize, setNomDispSize] = useState(null)
  const [nomSaving, setNomSaving] = useState(false)
  const [nomZoneValidated, setNomZoneValidated] = useState(false)  // étape 1 validée
  const [catalogueColumnTemplate, setCatalogueColumnTemplate] = useState(null)
  // État par zone (indexé par index de zone) : { columnTemplate, detecting, detectResult, lignes, lignesLoading, cropW }
  const [nomZoneState, setNomZoneState] = useState({})
  const nomImgContainerRef = useRef(null)
  const nomImgRef = useRef(null)
  // Met à jour un champ de l'état d'une zone spécifique
  const setZoneState = (zoneIdx, patch) =>
    setNomZoneState(prev => ({ ...prev, [zoneIdx]: { ...(prev[zoneIdx] ?? {}), ...patch } }))

  const imgContainerRef = useRef(null)
  const reperesContainerRef = useRef(null)
  const schemaContainerRef = useRef(null)

  const refresh = async () => {
    const g = await api.getGroupe(id)
    setGroupe(g)
    setTitre(g.titre ?? '')
    setRefsVues(g.refsVues ?? [])
    setSchemaBbox(g.schema_bbox ?? null)
  }

  useEffect(() => {
    Promise.all([api.getGroupe(id)])
      .then(([g]) => {
        setGroupe(g)
        setTitre(g.titre ?? '')
        setRefsVues(g.refsVues ?? [])
        setSchemaBbox(g.schema_bbox ?? null)
        return api.getCataloguePages(g.id_catalogue)
      })
      .then(setPages)
      .finally(() => setLoading(false))
  }, [id])

  // Mesure naturalSize depuis l'image (une seule fois au chargement)
  useEffect(() => {
    const read = () => {
      const img = document.querySelector('.page-viewer-img')
      if (img?.naturalWidth) setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight })
    }
    read()
    const img = document.querySelector('.page-viewer-img')
    if (img) img.addEventListener('load', read)
    return () => { if (img) img.removeEventListener('load', read) }
  }, [tab, groupe?.id_page_schema])

  // Mesure displaySize depuis le conteneur du PageViewer (pas l'image, qui peut déborder si crop)
  useEffect(() => {
    const container = reperesContainerRef.current ?? schemaContainerRef.current
    if (!container) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setDisplaySize({ w: width, h: height })
    })
    ro.observe(container)
    return () => ro.disconnect()
  }, [tab, schemaBbox])

  // Mesure displaySize pour l'image pleine dans l'onglet nomenclature
  useEffect(() => {
    if (tab !== 'nomenclature' || !nomImgContainerRef.current) return
    const ro = new ResizeObserver(([entry]) => {
      setNomDispSize({ w: entry.contentRect.width, h: entry.contentRect.height })
    })
    ro.observe(nomImgContainerRef.current)
    return () => ro.disconnect()
  }, [tab, nomPageId])

  // Quand on sélectionne une page membre dans l'onglet nomenclature
  const handleNomSelectPage = async (pageId) => {
    setNomPageId(pageId)
    setNomNatSize(null)
    setNomDispSize(null)
    setNomZoneValidated(false)
    setNomZoneState({})
    if (!pageId) { setNomBboxes([]); setNomActiveBbox(0); return }
    const membre = groupe.membres?.find(m => m.id === parseInt(pageId))
    const bboxes = membre?.gp_nomenclature_bboxes ?? []
    setNomBboxes(bboxes.length ? bboxes : [])
    setNomActiveBbox(0)
    if (bboxes.length > 0) setNomZoneValidated(true)
    // Charger le column_template catalogue si pas encore chargé
    if (!catalogueColumnTemplate) {
      try {
        const cat = await api.getCatalogue(groupe.id_catalogue)
        setCatalogueColumnTemplate(cat.column_template ?? null)
      } catch {}
    }
    // Initialiser l'état de chaque zone : column_template hérité du groupe, lignes vides
    const gpTemplate = membre?.gp_column_template ?? null
    const initZoneState = {}
    bboxes.forEach((_, i) => { initZoneState[i] = { columnTemplate: gpTemplate, lignes: [], lignesLoading: true, detectResult: null, cropW: null } })
    setNomZoneState(initZoneState)
    // Charger les nomenclatures existantes
    try {
      const lignes = await api.getPageNomenclature(parseInt(pageId))
      setNomZoneState(prev => {
        const next = { ...prev }
        bboxes.forEach((b, i) => {
          next[i] = { ...(next[i] ?? {}), lignes: lignes.filter(l => l.bbox_name === b.name), lignesLoading: false }
        })
        return next
      })
    } catch {
      setNomZoneState(prev => {
        const next = { ...prev }
        bboxes.forEach((_, i) => { next[i] = { ...(next[i] ?? {}), lignesLoading: false } })
        return next
      })
    }
  }

  const handleNomAddBbox = () => {
    const w = nomNatSize?.w || 3500
    const h = nomNatSize?.h || 4500
    const newBbox = { name: `Zone ${nomBboxes.length + 1}`, x1: Math.round(w * 0.05), y1: Math.round(h * 0.4), x2: Math.round(w * 0.95), y2: Math.round(h * 0.75) }
    const next = [...nomBboxes, newBbox]
    setNomBboxes(next)
    setNomActiveBbox(next.length - 1)
  }

  const handleNomRemoveBbox = (idx) => {
    const next = nomBboxes.filter((_, i) => i !== idx)
    setNomBboxes(next)
    setNomActiveBbox(Math.min(nomActiveBbox, next.length - 1))
  }

  const handleNomBboxChange = (newBbox) => {
    setNomBboxes(prev => prev.map((b, i) => i === nomActiveBbox ? { ...b, ...newBbox } : b))
  }

  const handleNomBboxNameChange = (idx, name) => {
    setNomBboxes(prev => prev.map((b, i) => i === idx ? { ...b, name } : b))
  }

  const handleNomSaveZones = async () => {
    if (!nomPageId) return
    setNomSaving(true)
    try {
      await api.patchGroupePage(id, nomPageId, { nomenclature_bboxes: nomBboxes })
      setGroupe(g => ({
        ...g,
        membres: g.membres.map(m => m.id === parseInt(nomPageId) ? { ...m, gp_nomenclature_bboxes: nomBboxes } : m)
      }))
      setNomZoneValidated(true)
      // Initialiser l'état des zones si pas encore fait
      setNomZoneState(prev => {
        const next = { ...prev }
        nomBboxes.forEach((b, i) => {
          if (!next[i]) next[i] = { columnTemplate: catalogueColumnTemplate, lignes: [], lignesLoading: false, detectResult: null, cropW: null }
        })
        return next
      })
    } catch (e) {
      alert(`Erreur : ${e.message}`)
    } finally {
      setNomSaving(false)
    }
  }

  // Sauvegarde du pattern pour une zone spécifique
  const handleNomSavePattern = async (zoneIdx, ctTemplate) => {
    if (!nomPageId || !ctTemplate) return
    const { dividers, zones } = ctTemplate
    // zones a toujours (dividers.length + 1) éléments
    // dividers[i] = bord droit de zones[i], la dernière zone va jusqu'à 1.0
    const columns = zones.map((z, i) => ({ role: z.role, x_rel_right: i < dividers.length ? dividers[i].x_rel : 1.0 })).filter(c => c.role !== 'ignore')
    const templateToSave = { columns }
    try {
      await api.patchGroupePage(id, nomPageId, { column_template: templateToSave })
      setZoneState(zoneIdx, { columnTemplate: templateToSave, patternSaved: true })
      setGroupe(g => ({
        ...g,
        membres: g.membres.map(m => m.id === parseInt(nomPageId) ? { ...m, gp_column_template: templateToSave } : m)
      }))
    } catch (e) {
      alert(`Erreur : ${e.message}`)
    }
  }

  // Détection OCR pour une zone spécifique
  const handleNomDetect = async (zoneIdx) => {
    if (!nomPageId) return
    setZoneState(zoneIdx, { detecting: true, detectResult: null })
    try {
      const result = await api.rerunGroupePageNomenclature(id, nomPageId)
      setZoneState(zoneIdx, { detecting: false, detectResult: { ok: !result.error, inserted: result.inserted, error: result.error } })
      if (!result.error) {
        const [lignes] = await Promise.all([api.getPageNomenclature(parseInt(nomPageId)), refresh()])
        const allLignes = lignes ?? []
        // Redistribuer les lignes par zone
        setNomZoneState(prev => {
          const next = { ...prev }
          nomBboxes.forEach((b, i) => {
            next[i] = { ...(next[i] ?? {}), lignes: allLignes.filter(l => l.bbox_name === b.name) }
          })
          return next
        })
      }
    } catch (e) {
      setZoneState(zoneIdx, { detecting: false, detectResult: { ok: false, error: e.message } })
    }
  }

  const handleSaveTitre = async () => {
    await api.patchGroupe(id, { titre })
    setTitreSaved(true)
    setTimeout(() => setTitreSaved(false), 2000)
  }

  const handleSetSchema = async (pageId) => {
    await api.patchGroupe(id, { id_page_schema: pageId || null })
    await refresh()
  }

  const handleAddPage = async (pageId) => {
    if (!pageId) return
    await api.addGroupePage(id, parseInt(pageId))
    await refresh()
  }

  const handleRemovePage = async (pageId) => {
    await api.removeGroupePage(id, pageId)
    await refresh()
  }

  // Sauvegarde schema_bbox dans column_template du catalogue
  const handleSaveBbox = async () => {
    if (!schemaBbox || !groupe) return
    setBboxSaving(true)
    setBboxMsg(null)
    try {
      const cat = await api.getCatalogue(groupe.id_catalogue)
      const column_template = { ...(cat.column_template ?? {}), schema_bbox: schemaBbox }
      await api.patchCatalogue(groupe.id_catalogue, { column_template })
      setBboxMsg('Zone schéma sauvegardée')
    } catch (e) {
      setBboxMsg(`Erreur : ${e.message}`)
    } finally {
      setBboxSaving(false)
    }
  }

  const handleInitBbox = () => {
    const w = naturalSize?.w || 3500
    const h = naturalSize?.h || 4500
    setSchemaBbox({ x1: Math.round(w * 0.05), y1: Math.round(h * 0.1), x2: Math.round(w * 0.55), y2: Math.round(h * 0.85) })
  }

  // Repères
  const addRepere = async ({ part_number, pos_x, pos_y }) => {
    if (!groupe?.id_page_schema) return
    const r = await api.addRefVue(groupe.id_page_schema, { part_number, pos_x, pos_y })
    setRefsVues(prev => [...prev, { ...r, liaisons: [] }].sort((a, b) => parseInt(a.part_number) - parseInt(b.part_number)))
  }

  const deleteRepere = async (r) => {
    if (!window.confirm(`Supprimer le repère ${r.part_number} ?`)) return
    await api.deleteRefVue(r.id)
    setRefsVues(prev => prev.filter(x => x.id !== r.id))
  }

  const handleRerunVues = async () => {
    if (!groupe?.id_page_schema) return
    setRerunningVues(true)
    setVuesMsg(null)
    try {
      const result = await api.rerunVues(groupe.id_page_schema)
      setVuesMsg(`${result.inserted} repère(s) détecté(s)`)
      await refresh()
    } catch (e) {
      setVuesMsg(`Erreur : ${e.message}`)
    } finally {
      setRerunningVues(false)
    }
  }

  const handleJointure = async () => {
    setJoiningLoad(true)
    setJointure(null)
    try {
      const result = await api.joinGroupeNomenclatures(id)
      setJointure({ ok: true, matched: result.matched })
      await refresh()
    } catch (e) {
      setJointure({ ok: false, error: e.message })
    } finally {
      setJoiningLoad(false)
    }
  }

  if (loading) return <progress className="or-progress" />
  if (!groupe) return <p className="or-muted">Groupe introuvable.</p>

  const membresIds = new Set(groupe.membres?.map(m => m.id) ?? [])

  const schemaPage = groupe.id_page_schema ? {
    id: groupe.id_page_schema,
    image: groupe.image,
    thumb: groupe.thumb,
    numero: groupe.membres?.find(m => m.id === groupe.id_page_schema)?.numero,
    nomenclature_bbox: groupe.nomenclature_bbox,
    nomenclature_bboxes: groupe.nomenclature_bboxes,
  } : null

  // Toutes les nomenclatures du groupe pour les liaisons manuelles
  const allNomenclatures = groupe.nomenclatures ?? []

  return (
    <div>
      <div className="or-breadcrumb">
        <Link to="/catalogues">Catalogues</Link>
        <ChevronRight size={12} />
        <Link to={`/admin/catalogue/${groupe.id_catalogue}`}>Catalogue</Link>
        <ChevronRight size={12} />
        <Link to={`/admin/catalogue/${groupe.id_catalogue}/groupes`}>Groupes</Link>
        <ChevronRight size={12} />
        <span>{groupe.titre}</span>
      </div>

      <div className="or-page-header" style={{ alignItems: 'flex-start', gap: '1rem' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', marginBottom: '.25rem' }}>
            <input
              className="or-input"
              value={titre}
              onChange={e => setTitre(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSaveTitre()}
              style={{ fontSize: '1.25rem', fontWeight: 700, maxWidth: 480 }}
            />
            <button className="or-btn or-btn-ghost or-btn-sm" onClick={handleSaveTitre}>
              {titreSaved ? <Check size={14} color="#22c55e" /> : 'Sauver'}
            </button>
          </div>
          <p className="or-page-subtitle">
            {groupe.membres?.length ?? 0} pages membres · {refsVues.length} repères · {allNomenclatures.length} nomenclatures
          </p>
        </div>
        <Link to={`/groupe/${id}`} className="or-btn or-btn-ghost or-btn-sm" target="_blank">
          Voir la page publique ↗
        </Link>
      </div>

      <div className="or-tabs" style={{ marginBottom: '1.5rem' }}>
        {TABS.map(t => (
          <button key={t.id} className={`or-tab${tab === t.id ? ' active' : ''}`} onClick={() => { setTab(t.id); setShowReperes(false); setEditBbox(false); setNomMsg(null) }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── ONGLET MEMBRES ── */}
      {tab === 'membres' && (
        <PageMembresGrid
          pages={pages}
          membresIds={membresIds}
          schemaId={groupe.id_page_schema}
          onToggle={(pageId, isMembre) => isMembre ? handleRemovePage(pageId) : handleAddPage(pageId)}
        />
      )}

      {/* ── ONGLET SCHEMA & ZONE ── */}
      {tab === 'schema' && (
        <div className="columns" style={{ alignItems: 'flex-start' }}>
          <div className="column is-one-third">
            <div className="or-box" style={{ marginBottom: '1rem' }}>
              <p style={{ fontWeight: 600, marginBottom: '.75rem' }}>Page schéma</p>
              <p style={{ fontSize: '.8rem', color: 'var(--text-muted)', marginBottom: '.75rem' }}>
                La page schéma fournit l'illustration et les positions des repères pour tout le groupe.
              </p>
              <select
                className="or-input"
                value={groupe.id_page_schema ?? ''}
                onChange={e => handleSetSchema(e.target.value)}
                style={{ fontSize: '.85rem' }}
              >
                <option value="">— aucune —</option>
                {pages.map(p => (
                  <option key={p.id} value={p.id}>P.{p.numero}{p.titre ? ` — ${p.titre}` : ''}</option>
                ))}
              </select>
            </div>

            <div className="or-box">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.75rem' }}>
                <p style={{ fontWeight: 600 }}>Zone schéma (crop)</p>
                <button
                  className={`or-btn or-btn-sm ${editBbox ? 'or-btn-warning' : 'or-btn-secondary'}`}
                  onClick={() => { setEditBbox(e => !e); setBboxMsg(null) }}
                  disabled={!schemaPage}
                >
                  <Move size={13} /> {editBbox ? 'Terminer' : 'Éditer'}
                </button>
              </div>
              <p style={{ fontSize: '.8rem', color: 'var(--text-muted)', marginBottom: '.75rem' }}>
                Délimite la zone d'illustration affichée dans les vignettes et la page publique du groupe.
              </p>

              {schemaBbox
                ? <div style={{ fontSize: '.8rem', fontFamily: 'monospace', background: 'var(--bg-subtle)', padding: '.5rem .75rem', borderRadius: 6, marginBottom: '.75rem' }}>
                    x1={schemaBbox.x1} y1={schemaBbox.y1}<br />
                    x2={schemaBbox.x2} y2={schemaBbox.y2}
                  </div>
                : <p style={{ fontSize: '.8rem', color: 'var(--text-muted)', marginBottom: '.75rem' }}>Aucune zone définie.</p>
              }

              <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                {!schemaBbox && schemaPage && (
                  <button className="or-btn or-btn-secondary or-btn-sm" onClick={handleInitBbox}>
                    <Plus size={13} /> Créer une zone
                  </button>
                )}
                {schemaBbox && (
                  <button className="or-btn or-btn-primary or-btn-sm" onClick={handleSaveBbox} disabled={bboxSaving}>
                    <Check size={13} /> Sauvegarder
                  </button>
                )}
                {schemaBbox && (
                  <button className="or-btn or-btn-ghost or-btn-sm" style={{ color: '#ef4444' }} onClick={() => setSchemaBbox(null)}>
                    Supprimer la zone
                  </button>
                )}
              </div>
              {bboxMsg && (
                <p style={{ marginTop: '.5rem', fontSize: '.8rem', color: bboxMsg.startsWith('Erreur') ? '#dc2626' : '#15803d' }}>{bboxMsg}</p>
              )}
            </div>
          </div>

          <div className="column" ref={imgContainerRef}>
            {schemaPage ? (
              <div ref={schemaContainerRef} style={{ position: 'relative' }}>
                <PageViewer
                  page={schemaPage}
                  refsVues={[]}
                  showNomenclature={false}
                />
                {schemaBbox && naturalSize && displaySize && (
                  <BboxEditor
                    bbox={schemaBbox}
                    imageW={naturalSize.w}
                    imageH={naturalSize.h}
                    displayW={displaySize.w}
                    displayH={displaySize.h}
                    onChange={setSchemaBbox}
                    inactive={!editBbox}
                    color="#f59e0b"
                  />
                )}
              </div>
            ) : (
              <div className="or-box" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                Sélectionnez une page schéma pour voir l'illustration
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── ONGLET ÉDITION & NOMENCLATURE ── */}
      {tab === 'nomenclature' && (() => {
        const membres = groupe.membres ?? []
        const nomPage = membres.find(m => m.id === parseInt(nomPageId))

        return (
          <div>
            {/* Sélecteur de page membre */}
            <div className="or-box" style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <label style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>Page membre :</label>
                <select
                  className="or-input"
                  value={nomPageId ?? ''}
                  onChange={e => handleNomSelectPage(e.target.value ? parseInt(e.target.value) : null)}
                  style={{ maxWidth: 340, fontSize: '.85rem' }}
                >
                  <option value="">— sélectionner une page membre —</option>
                  {membres.map(m => (
                    <option key={m.id} value={m.id}>
                      P.{m.numero}{m.titre ? ` — ${m.titre}` : ''}
                      {(m.gp_nomenclature_bboxes?.length > 0) ? ` ✓ (${m.gp_nomenclature_bboxes.length} zone(s))` : ''}
                    </option>
                  ))}
                </select>
                {membres.length === 0 && (
                  <span className="or-muted">Aucune page membre — ajoutez des pages dans l'onglet "Pages membres"</span>
                )}
              </div>
            </div>

            {!nomPageId && (
              <div className="or-box" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                Sélectionnez une page membre pour définir ses zones de nomenclature
              </div>
            )}

            {nomPage && (
              <div>
                {/* ─── SECTION 1 : Zonage sur image pleine ─── */}
                <div className="columns" style={{ alignItems: 'flex-start', marginBottom: '1.5rem' }}>

                  {/* Image + BboxEditor */}
                  <div className="column is-two-thirds">
                    <div
                      ref={nomImgContainerRef}
                      style={{ position: 'relative', background: '#000', borderRadius: 8, overflow: 'hidden' }}
                    >
                      <img
                        ref={nomImgRef}
                        src={nomPage.image}
                        alt=""
                        style={{ width: '100%', display: 'block' }}
                        onLoad={e => {
                          setNomNatSize({ w: e.target.naturalWidth, h: e.target.naturalHeight })
                          setNomDispSize({ w: e.target.offsetWidth, h: e.target.offsetHeight })
                        }}
                      />
                      {nomNatSize && nomDispSize && nomBboxes.map((b, i) => {
                        const isActive = i === nomActiveBbox
                        if (isActive) {
                          return (
                            <BboxEditor
                              key={i}
                              bbox={b}
                              imageW={nomNatSize.w}
                              imageH={nomNatSize.h}
                              displayW={nomDispSize.w}
                              displayH={nomDispSize.h}
                              onChange={handleNomBboxChange}
                              color="#a855f7"
                            />
                          )
                        }
                        const sx = nomDispSize.w / nomNatSize.w
                        const sy = nomDispSize.h / nomNatSize.h
                        return (
                          <div
                            key={i}
                            onClick={() => setNomActiveBbox(i)}
                            title={b.name || `Zone ${i + 1}`}
                            style={{
                              position: 'absolute',
                              left: b.x1 * sx, top: b.y1 * sy,
                              width: (b.x2 - b.x1) * sx, height: (b.y2 - b.y1) * sy,
                              border: '2px dashed #a855f7', opacity: .5,
                              cursor: 'pointer', boxSizing: 'border-box',
                            }}
                          >
                            {b.name && (
                              <span style={{
                                position: 'absolute', top: 2, left: 4, fontSize: 10, fontWeight: 600,
                                color: '#a855f7', background: 'rgba(0,0,0,.6)', padding: '1px 4px', borderRadius: 3,
                              }}>{b.name}</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* Panel zonage — sticky */}
                  <div className="column is-one-third" style={{ position: 'sticky', top: 72 }}>
                    <div style={{
                      border: `1px solid ${nomZoneValidated ? '#22c55e' : '#a855f7'}`,
                      borderRadius: 10, overflow: 'hidden',
                      background: nomZoneValidated ? 'rgba(34,197,94,.04)' : 'var(--bg-card)',
                    }}>
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: '.5rem',
                        padding: '.65rem .85rem',
                        background: nomZoneValidated ? 'rgba(34,197,94,.08)' : 'rgba(168,85,247,.07)',
                        borderBottom: '1px solid var(--border)',
                      }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          width: 22, height: 22, borderRadius: '50%', fontSize: 11, fontWeight: 700,
                          background: nomZoneValidated ? '#22c55e' : '#a855f7', color: '#fff', flexShrink: 0,
                        }}>
                          {nomZoneValidated ? <Check size={12} /> : '1'}
                        </span>
                        <span style={{ fontWeight: 600, fontSize: '.85rem', flex: 1 }}>Zones de nomenclature</span>
                        {nomZoneValidated && <span style={{ fontSize: '.73rem', color: '#15803d' }}>Validé</span>}
                      </div>
                      <div style={{ padding: '.75rem' }}>
                        {nomBboxes.length === 0 && (
                          <p style={{ fontSize: '.82rem', color: 'var(--text-muted)', marginBottom: '.5rem' }}>
                            Ajoutez au moins une zone pour délimiter la table de nomenclature.
                          </p>
                        )}
                        {nomBboxes.map((b, i) => (
                          <div
                            key={i}
                            onClick={() => setNomActiveBbox(i)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '.4rem',
                              padding: '.3rem .5rem', borderRadius: 6, marginBottom: '.3rem',
                              background: i === nomActiveBbox ? 'rgba(168,85,247,.12)' : 'var(--bg-subtle)',
                              border: `1px solid ${i === nomActiveBbox ? '#a855f7' : 'transparent'}`,
                              cursor: 'pointer',
                            }}
                          >
                            <input
                              className="or-input"
                              value={b.name ?? ''}
                              onChange={e => { e.stopPropagation(); handleNomBboxNameChange(i, e.target.value) }}
                              onClick={e => e.stopPropagation()}
                              style={{ flex: 1, fontSize: '.8rem', padding: '2px 6px' }}
                              placeholder={`Zone ${i + 1}`}
                            />
                            <button
                              className="or-btn or-btn-ghost or-btn-sm or-btn-icon-only"
                              onClick={e => { e.stopPropagation(); handleNomRemoveBbox(i) }}
                              style={{ color: '#ef4444' }}
                            ><X size={12} /></button>
                          </div>
                        ))}
                        <div style={{ display: 'flex', gap: '.4rem', marginTop: '.5rem' }}>
                          <button className="or-btn or-btn-secondary or-btn-sm" onClick={handleNomAddBbox} style={{ flex: 1 }}>
                            <Plus size={13} /> Ajouter
                          </button>
                          <button
                            className="or-btn or-btn-primary or-btn-sm" style={{ flex: 1 }}
                            onClick={handleNomSaveZones} disabled={nomSaving || nomBboxes.length === 0}
                          >
                            <Check size={13} /> Valider
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ─── SECTION 2 : Une section par zone ─── */}
                {nomZoneValidated && nomBboxes.length > 0 && (
                  <div>
                    <div style={{ borderTop: '2px solid var(--border)', marginBottom: '1.25rem', paddingTop: '1.25rem' }}>
                      <p style={{ fontWeight: 700, fontSize: '.95rem', color: 'var(--text-muted)' }}>
                        Zones — Pattern & Détection
                      </p>
                    </div>

                    {nomBboxes.map((bbox, zoneIdx) => {
                      const zs = nomZoneState[zoneIdx] ?? {}
                      const initTpl = zs.columnTemplate ?? catalogueColumnTemplate ?? null
                      const ctbPage = nomNatSize ? { image: nomPage.image, nomenclature_bbox: bbox } : null
                      const lignes = zs.lignes ?? []
                      const cropW = zs.cropW ?? null

                      return (
                        <div
                          key={zoneIdx}
                          style={{
                            marginBottom: '2rem', border: '1px solid var(--border)',
                            borderRadius: 12, overflow: 'hidden',
                          }}
                        >
                          {/* En-tête de zone */}
                          <div style={{
                            padding: '.6rem 1rem', background: 'rgba(168,85,247,.06)',
                            borderBottom: '1px solid var(--border)',
                            display: 'flex', alignItems: 'center', gap: '.6rem',
                          }}>
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              width: 22, height: 22, borderRadius: '50%',
                              background: '#a855f7', color: '#fff', fontSize: 11, fontWeight: 700,
                            }}>{zoneIdx + 1}</span>
                            <span style={{ fontWeight: 700, fontSize: '.9rem' }}>{bbox.name || `Zone ${zoneIdx + 1}`}</span>
                          </div>

                          {/* Corps : crop | pattern+détection+lignes */}
                          <div className="columns" style={{ alignItems: 'flex-start', margin: 0 }}>

                            {/* Colonne gauche : pattern sticky */}
                            <div
                              className="column is-two-fifths"
                              style={{ position: 'sticky', top: 72, padding: '1rem', borderRight: '1px solid var(--border)' }}
                            >
                              {/* Pattern : ColumnTemplateBuilder */}
                              {ctbPage && nomNatSize && (
                                <div>
                                  <p style={{ fontSize: '.78rem', fontWeight: 600, color: '#a855f7', marginBottom: '.4rem' }}>
                                    Pattern colonnes
                                  </p>
                                  <ColumnTemplateBuilder
                                    page={ctbPage}
                                    imageW={nomNatSize.w}
                                    imageH={nomNatSize.h}
                                    onChange={tpl => setZoneState(zoneIdx, { columnTemplate: tpl })}
                                    initialTemplate={initTpl}
                                  />
                                  <button
                                    className="or-btn or-btn-primary or-btn-sm"
                                    style={{ width: '100%', marginTop: '.5rem' }}
                                    onClick={() => handleNomSavePattern(zoneIdx, zs.columnTemplate)}
                                    disabled={nomSaving || !zs.columnTemplate}
                                  >
                                    <Check size={13} />
                                    {zs.patternSaved ? 'Pattern sauvegardé ✓' : 'Sauvegarder le pattern'}
                                  </button>
                                </div>
                              )}

                              {/* Détection OCR */}
                              <div style={{ marginTop: '.75rem', paddingTop: '.75rem', borderTop: '1px solid var(--border)' }}>
                                <button
                                  className="or-btn or-btn-secondary or-btn-sm"
                                  style={{ width: '100%' }}
                                  onClick={() => handleNomDetect(zoneIdx)}
                                  disabled={zs.detecting}
                                >
                                  <RefreshCw size={13} className={zs.detecting ? 'spin' : ''} />
                                  {zs.detecting ? 'Détection…' : 'Lancer la détection OCR'}
                                </button>
                                {zs.detectResult && (
                                  <div style={{
                                    marginTop: '.4rem', padding: '.35rem .6rem', borderRadius: 6, fontSize: '.8rem',
                                    display: 'flex', alignItems: 'center', gap: '.4rem',
                                    background: zs.detectResult.ok ? '#f0fdf4' : '#fef2f2',
                                    color: zs.detectResult.ok ? '#166534' : '#991b1b',
                                  }}>
                                    {zs.detectResult.ok ? <Check size={12} /> : <AlertCircle size={12} />}
                                    {zs.detectResult.ok
                                      ? `${zs.detectResult.inserted ?? lignes.length} ligne(s) extraite(s)`
                                      : `Erreur : ${zs.detectResult.error}`}
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Colonne droite : tableau nomenclature */}
                            <div className="column" style={{ padding: '1rem' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.5rem' }}>
                                <span style={{ fontWeight: 600, fontSize: '.83rem' }}>Nomenclature</span>
                                <span style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>
                                  {zs.lignesLoading ? 'Chargement…' : `${lignes.length} ligne(s)`}
                                </span>
                                {lignes.length > 0 && (
                                  <button
                                    className="or-btn or-btn-ghost or-btn-sm"
                                    style={{ marginLeft: 'auto', fontSize: '.75rem', color: '#15803d' }}
                                    onClick={async () => {
                                      const ids = lignes.filter(l => !l.corrige).map(l => l.id)
                                      if (!ids.length) return
                                      await api.bulkCorrigeNomenclature(ids, true)
                                      setZoneState(zoneIdx, { lignes: lignes.map(l => ids.includes(l.id) ? { ...l, corrige: true } : l) })
                                    }}
                                  >
                                    <Check size={12} /> Tout valider
                                  </button>
                                )}
                              </div>
                              <div className="or-box" style={{ padding: 0, overflow: 'hidden' }}>
                                <table className="or-table">
                                  <thead>
                                    <tr>
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
                                    {zs.lignesLoading ? (
                                      <tr><td colSpan={7} style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-muted)', fontSize: '.82rem' }}>Chargement…</td></tr>
                                    ) : lignes.length === 0 ? (
                                      <tr><td colSpan={7} className="or-muted" style={{ textAlign: 'center', padding: '1.5rem', fontSize: '.82rem' }}>Aucune ligne — lancez la détection OCR</td></tr>
                                    ) : lignes.map(l => (
                                      <NomenclatureRow
                                        key={l.id}
                                        data={l}
                                        reperes={[]}
                                        onUpdated={updated => setZoneState(zoneIdx, { lignes: lignes.map(x => x.id === updated.id ? updated : x) })}
                                        onDeleted={delId => setZoneState(zoneIdx, { lignes: lignes.filter(x => x.id !== delId) })}
                                      />
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })()}

      {/* ── ONGLET REPÈRES & JOINTURE ── */}
      {tab === 'reperes' && (
        <div className="columns" style={{ alignItems: 'flex-start' }}>
          <div className="column is-half" style={{ position: 'sticky', top: '72px' }}>
            {schemaPage ? (
              <div ref={reperesContainerRef} style={{ position: 'relative' }}>
                <PageViewer
                  page={schemaPage}
                  refsVues={refsVues}
                  showNomenclature={false}
                  schemaOnly={!!schemaBbox}
                  schemaBbox={schemaBbox}
                />
                {showReperes && naturalSize && displaySize && (
                  <ReperesOverlay
                    pageId={groupe.id_page_schema}
                    naturalSize={naturalSize}
                    displaySize={displaySize}
                    schemaBbox={schemaBbox}
                    onAdd={addRepere}
                  />
                )}
              </div>
            ) : (
              <div className="or-box" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                Aucune page schéma définie
              </div>
            )}

            {/* Toolbar repères */}
            {schemaPage && (
              <div style={{ display: 'flex', gap: '.5rem', marginTop: '.75rem', flexWrap: 'wrap' }}>
                <button
                  className={`or-btn or-btn-sm ${showReperes ? 'or-btn-warning' : 'or-btn-secondary'}`}
                  onClick={() => setShowReperes(s => !s)}
                  title="Clic sur l'image pour ajouter un repère"
                >
                  <Plus size={13} /> {showReperes ? 'Annuler placement' : 'Placer un repère'}
                </button>
                <button
                  className={`or-btn or-btn-sm or-btn-secondary ${rerunningVues ? 'is-loading' : ''}`}
                  onClick={handleRerunVues}
                  disabled={rerunningVues}
                  title="Détection automatique des repères par OCR"
                >
                  <RotateCcw size={13} /> Détecter (OCR)
                </button>
                {vuesMsg && <span style={{ fontSize: '.8rem', color: 'var(--text-muted)', alignSelf: 'center' }}>{vuesMsg}</span>}
              </div>
            )}
          </div>

          <div className="column is-half">
            {/* Jointure */}
            <div className="or-box" style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.5rem' }}>
                <p style={{ fontWeight: 600 }}>Jointure repères ↔ nomenclatures</p>
                <button
                  className="or-btn or-btn-primary or-btn-sm"
                  onClick={handleJointure}
                  disabled={joiningLoad || !groupe.id_page_schema}
                  style={{ display: 'flex', alignItems: 'center', gap: '.35rem' }}
                >
                  <RefreshCw size={13} className={joiningLoad ? 'spin' : ''} />
                  Recalculer
                </button>
              </div>
              <p style={{ fontSize: '.8rem', color: 'var(--text-muted)', marginBottom: jointure ? '.5rem' : 0 }}>
                Lie chaque repère aux lignes de nomenclature correspondantes via <code>ref_no = repère</code> sur toutes les pages membres.
              </p>
              {jointure && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.5rem .75rem', borderRadius: 6, background: jointure.ok ? '#f0fdf4' : '#fef2f2', color: jointure.ok ? '#166534' : '#991b1b', fontSize: '.85rem' }}>
                  {jointure.ok ? <Check size={14} /> : <AlertCircle size={14} />}
                  {jointure.ok ? `${jointure.matched} liaison(s) créée(s)` : jointure.error}
                </div>
              )}
            </div>

            {/* Tableau repères */}
            <div className="or-box" style={{ padding: 0, overflow: 'hidden' }}>
              <table className="or-table">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>#</th>
                    <th>Nomenclatures liées</th>
                    <th style={{ width: 40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {refsVues.length === 0 && (
                    <tr><td colSpan={3} className="or-muted" style={{ textAlign: 'center', padding: '1.5rem' }}>Aucun repère — utilisez "Détecter" ou "Placer un repère"</td></tr>
                  )}
                  {refsVues.map(rv => {
                    const liaisons = rv.liaisons ?? []
                    const linkedIds = new Set(liaisons.map(l => l.nomenclature_id))
                    const available = allNomenclatures.filter(n => !linkedIds.has(n.id))
                    return (
                      <tr key={rv.id} style={{ verticalAlign: 'top' }}>
                        <td style={{ paddingTop: '.6rem' }}>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            background: liaisons.length > 0 ? '#8b5cf6' : '#9ca3af',
                            color: '#fff', borderRadius: '50%', width: 22, height: 22, fontSize: 11, fontWeight: 'bold',
                          }}>
                            {rv.part_number}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
                            {liaisons.map(l => (
                              <div key={l.nomenclature_id} style={{ display: 'flex', alignItems: 'center', gap: '.3rem', fontSize: '.78rem' }}>
                                <span className="or-mono" style={{ fontSize: '.75rem' }}>{l.part_number}</span>
                                {l.description && <span className="or-muted" style={{ fontSize: '.75rem' }}>— {l.description.slice(0, 40)}{l.description.length > 40 ? '…' : ''}</span>}
                                <span style={{ fontSize: '.68rem', color: 'var(--text-muted)', marginLeft: 'auto', whiteSpace: 'nowrap' }}>P.{l.page_numero}</span>
                              </div>
                            ))}
                            {liaisons.length === 0 && (
                              <span style={{ fontSize: '.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Aucune liaison — relancer la jointure</span>
                            )}
                          </div>
                        </td>
                        <td style={{ paddingTop: '.5rem' }}>
                          <button className="or-btn or-btn-ghost or-btn-sm or-btn-icon-only" onClick={() => deleteRepere(rv)} title="Supprimer le repère">
                            <X size={12} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
