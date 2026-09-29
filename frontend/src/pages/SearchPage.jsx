import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import SearchHero from '../components/SearchHero'
import CompactSearchBar from '../components/CompactSearchBar'
import StatsBar from '../components/StatsBar'
import CatalogueGrid from '../components/CatalogueGrid'
import RecentSearches, { loadRecentSearches, pushRecentSearch, clearRecentSearches } from '../components/RecentSearches'
import EmptyState from '../components/EmptyState'
import ResultsTable from '../components/ResultsTable'
import { api } from '../api/client'

const MARQUE_STORAGE_KEY = 'openref_marque'

export default function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialQ = searchParams.get('q') || ''
  const initialMarque = searchParams.get('marque') || localStorage.getItem(MARQUE_STORAGE_KEY) || ''

  const [q, setQ] = useState(initialQ)
  const [marque, setMarque] = useState(initialMarque)
  const [results, setResults] = useState(null)      // tableau de résultats, ou null tant qu'aucune recherche
  const [suggestions, setSuggestions] = useState([])
  const [marqueVide, setMarqueVide] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [catalogues, setCatalogues] = useState([])
  const [recent, setRecent] = useState(() => loadRecentSearches())
  const [stats, setStats] = useState(null)

  // Évite de relancer la recherche initiale une seconde fois via l'effet de synchro URL
  const searchedOnMount = useRef(false)

  useEffect(() => {
    api.getCatalogues().then(setCatalogues).catch(() => setCatalogues([]))
    // Un seul fetch /api/stats, partagé entre StatsBar (chiffres) et SearchHero (exemples de recherche)
    api.getStats().then(setStats).catch(() => setStats(null))
  }, [])

  const runSearch = useCallback(async (query, marqueValue) => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.search(query, marqueValue)
      if (Array.isArray(res)) {
        setResults(res)
        setSuggestions([])
        setMarqueVide(false)
      } else {
        setResults(res.results ?? [])
        setSuggestions(res.suggestions ?? [])
        setMarqueVide(!!res.marqueVide)
      }
      setRecent(pushRecentSearch(query, marqueValue))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const search = useCallback((query, marqueValue) => {
    setQ(query)
    if (marqueValue !== undefined) setMarque(marqueValue || '')
    const params = { q: query }
    if (marqueValue) params.marque = marqueValue
    setSearchParams(params)
    runSearch(query, marqueValue)
  }, [runSearch, setSearchParams])

  // Requête reflétée dans l'URL au chargement (partage de lien / bouton retour)
  useEffect(() => {
    if (searchedOnMount.current) return
    searchedOnMount.current = true
    if (initialQ.trim().length >= 2) runSearch(initialQ, initialMarque || undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Marque mémorisée en localStorage dès qu'elle change
  useEffect(() => {
    try {
      if (marque) localStorage.setItem(MARQUE_STORAGE_KEY, marque)
      else localStorage.removeItem(MARQUE_STORAGE_KEY)
    } catch { /* localStorage indisponible, on ignore */ }
  }, [marque])

  const handleClearRecent = () => {
    clearRecentSearches()
    setRecent([])
  }

  // Vide q → repasse en mode accueil (hero + grille catalogues), garde la marque mémorisée
  const backToHome = useCallback(() => {
    setQ('')
    setResults(null)
    setSuggestions([])
    setSearchParams(marque ? { marque } : {})
  }, [marque, setSearchParams])

  const hasSearched = results !== null

  return (
    <div>
      {hasSearched ? (
        <CompactSearchBar
          q={q} setQ={setQ} marque={marque} setMarque={setMarque} onSearch={search} loading={loading}
          onBackToHome={backToHome}
        />
      ) : (
        <SearchHero
          q={q} setQ={setQ} marque={marque} setMarque={setMarque} onSearch={search} loading={loading}
          exemples={stats?.exemples}
        />
      )}

      {!hasSearched && <StatsBar stats={stats} />}

      {!hasSearched && (
        <RecentSearches items={recent} onSelect={item => search(item.q, item.marque)} onClear={handleClearRecent} />
      )}

      {error && (
        <div className="or-alert or-alert-error" style={{ marginTop: '1rem' }}>
          {error}
        </div>
      )}

      {hasSearched && !error && (
        <div style={{ marginTop: '1.5rem' }}>
          {results.length > 0 ? (
            <>
              <p className="or-muted" style={{ fontSize: '.85rem', marginBottom: '.75rem' }}>
                {results.length} résultat{results.length !== 1 ? 's' : ''}
              </p>
              <ResultsTable results={results} />
            </>
          ) : (
            <EmptyState
              q={q}
              marque={marque}
              suggestions={suggestions}
              marqueVide={marqueVide}
              onPickSuggestion={pn => search(pn, marque || undefined)}
            />
          )}
        </div>
      )}

      {!hasSearched && (
        <div style={{ marginTop: '2rem' }}>
          <p className="or-section-title">Catalogues disponibles</p>
          <CatalogueGrid catalogues={catalogues} />
        </div>
      )}
    </div>
  )
}
