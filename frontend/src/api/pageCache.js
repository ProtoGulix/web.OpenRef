import { api } from './client'

// Petit cache mémoire (par session d'onglet) pour les données d'une page + ses repères.
// But : le survol d'une ligne de résultat précharge la page ; le dépliage qui suit (clic)
// réutilise directement ces données au lieu de refaire les mêmes requêtes réseau.
const cache = new Map()

/**
 * Retourne une promesse résolvant { page, refs, refsVues } pour une page donnée.
 * Appels concurrents/répétés pour le même pageId partagent la même promesse (pas de double fetch).
 *
 * Cas groupe : si la page est la page-schéma d'un groupe (plusieurs pages de nomenclature
 * partageant un même schéma éclaté — voir GroupePage.jsx), le tableau de références d'UNE
 * page ne suffit pas : les références liées aux repères peuvent être sur une autre page membre.
 * On charge alors le groupe et on normalise sa forme vers la même { page, refs, refsVues },
 * pour que PageDetailView n'ait pas besoin de connaître la distinction page/groupe.
 */
export function loadPageData(pageId) {
  if (!pageId) return Promise.resolve(null)
  if (cache.has(pageId)) return cache.get(pageId)

  const promise = api.getPage(pageId)
    .then(page => {
      if (page.groupe_id) return loadGroupeAsPageData(page.groupe_id)
      const refsPromise = page.has_nomenclature ? api.getPageNomenclature(pageId) : api.getPageRefs(pageId)
      return Promise.all([refsPromise, api.getPageRefsVues(pageId)])
        .then(([refs, refsVues]) => ({ page, refs, refsVues }))
    })
    .catch(err => {
      cache.delete(pageId) // échec : ne pas garder l'échec en cache, on pourra réessayer
      throw err
    })

  cache.set(pageId, promise)
  return promise
}

async function loadGroupeAsPageData(groupeId) {
  const groupe = await api.getGroupe(groupeId)
  // Reconstruit un objet "page" pour PageViewer à partir des données du groupe
  // (même transformation que GroupePage.jsx, seule vue existante sur les groupes à ce jour).
  const page = {
    id: groupe.id_page_schema,
    image: groupe.image,
    thumb: groupe.thumb,
    numero: null,
    titre: groupe.titre,
    marque: groupe.marque,
    modele: groupe.modele,
    nomenclature_bbox: groupe.nomenclature_bbox,
    nomenclature_bboxes: groupe.nomenclature_bboxes,
    _schemaBbox: groupe.schema_bbox ?? null,
    _isGroupe: true,
  }
  return { page, refs: groupe.nomenclatures ?? [], refsVues: groupe.refsVues ?? [] }
}

/** Précharge sans attendre le résultat (appel fire-and-forget au survol). */
export function preloadPageData(pageId) {
  if (pageId) loadPageData(pageId).catch(() => {})
}
