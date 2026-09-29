const BASE = '/api'

async function req(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, opts)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

export const api = {
  getCatalogues: () => req('/catalogues'),
  getCatalogue: id => req(`/catalogues/${id}`),
  createCatalogue: body => req('/catalogues', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  patchCatalogue: (id, body) => req(`/catalogues/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  deleteCatalogue: id => fetch(`${BASE}/catalogues/${id}`, { method: 'DELETE' }),
  rerunCatalogueNomenclature: (id) => `${BASE}/catalogues/${id}/rerun-nomenclature`,

  getCataloguePages: id => req(`/catalogues/${id}/pages`),
  getPage: id => req(`/pages/${id}`),
  patchPage: (id, body) => req(`/pages/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  getPageBlocs: id => req(`/pages/${id}/blocs`),

  getPageRefs: id => req(`/pages/${id}/references`),
  getPageNomenclature: id => req(`/pages/${id}/nomenclature`),
  getPageRefsVues: id => req(`/pages/${id}/refs-vues`),
  addRefVue: (pageId, body) => req(`/pages/${pageId}/refs-vues`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  ocrPoint: (pageId, cx, cy) => req(`/pages/${pageId}/ocr-point`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cx, cy }) }),
  addRefVueLiaison: (refVueId, nomenclatureId) => req(`/refs-vues/${refVueId}/nomenclatures`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nomenclature_id: nomenclatureId }) }),
  deleteRefVueLiaison: (refVueId, nomenclatureId) => fetch(`/api/refs-vues/${refVueId}/nomenclatures/${nomenclatureId}`, { method: 'DELETE' }),
  deleteRefVue: id => fetch(`/api/refs-vues/${id}`, { method: 'DELETE' }),
  rerunVues: id => req(`/pages/${id}/rerun-vues`, { method: 'POST' }),
  rerunNomenclature: id => req(`/pages/${id}/rerun-nomenclature`, { method: 'POST' }),
  patchNomenclature: (id, body) => req(`/nomenclature/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  deleteNomenclature: id => fetch(`${BASE}/nomenclature/${id}`, { method: 'DELETE' }),
  bulkCorrigeNomenclature: (ids, corrige) => req(`/nomenclature-bulk/corrige`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, corrige }) }),
  extractPageMeta: id => req(`/pages/${id}/extract-meta`, { method: 'POST' }),
  createRef: (pageId, body) => req(`/pages/${pageId}/references`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  patchRef: (id, body) => req(`/references/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  deleteRef: id => fetch(`${BASE}/references/${id}`, { method: 'DELETE' }),

  getSources: () => req('/sources'),
  createSource: body => req('/sources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  patchSource: (id, body) => req(`/sources/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  deleteSource: id => fetch(`${BASE}/sources/${id}`, { method: 'DELETE' }),

  // Retourne soit un tableau de résultats (recherche non vide), soit { results: [], suggestions, marqueVide }
  search: (q, marque) => req(`/search?q=${encodeURIComponent(q)}${marque ? `&marque=${marque}` : ''}`),
  searchSuggest: (q, marque) => req(`/search/suggest?q=${encodeURIComponent(q)}${marque ? `&marque=${marque}` : ''}`),
  getPrixArchive: partNumber => req(`/prix/archive/${encodeURIComponent(partNumber)}`),
  getStats: () => req('/stats'),

  getCatalogueGroupes: id => req(`/catalogues/${id}/groupes`),
  getGroupe: id => req(`/groupes/${id}`),
  createGroupe: (catalogueId, body) => req(`/catalogues/${catalogueId}/groupes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  patchGroupe: (id, body) => req(`/groupes/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  deleteGroupe: id => fetch(`/api/groupes/${id}`, { method: 'DELETE' }),
  addGroupePage: (groupeId, id_page) => req(`/groupes/${groupeId}/pages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id_page }) }),
  removeGroupePage: (groupeId, id_page) => fetch(`/api/groupes/${groupeId}/pages/${id_page}`, { method: 'DELETE' }),
  patchGroupePage: (groupeId, pageId, body) => req(`/groupes/${groupeId}/pages/${pageId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  rerunGroupePageNomenclature: (groupeId, pageId) => req(`/groupes/${groupeId}/pages/${pageId}/rerun-nomenclature`, { method: 'POST' }),
  joinGroupeNomenclatures: (groupeId) => req(`/groupes/${groupeId}/jointure`, { method: 'POST' }),
}
