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

  getCataloguePages: id => req(`/catalogues/${id}/pages`),
  getPage: id => req(`/pages/${id}`),
  patchPage: (id, body) => req(`/pages/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  getPageBlocs: id => req(`/pages/${id}/blocs`),

  getPageRefs: id => req(`/pages/${id}/references`),
  createRef: (pageId, body) => req(`/pages/${pageId}/references`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  patchRef: (id, body) => req(`/references/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  deleteRef: id => fetch(`${BASE}/references/${id}`, { method: 'DELETE' }),

  getSources: () => req('/sources'),
  createSource: body => req('/sources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  patchSource: (id, body) => req(`/sources/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  deleteSource: id => fetch(`${BASE}/sources/${id}`, { method: 'DELETE' }),

  search: (q, marque) => req(`/search?q=${encodeURIComponent(q)}${marque ? `&marque=${marque}` : ''}`),
  getPrixArchive: partNumber => req(`/prix/archive/${encodeURIComponent(partNumber)}`),
}
