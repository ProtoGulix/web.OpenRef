import { useEffect, useRef, useState } from 'react'

/**
 * Ouvre un EventSource SSE et appelle onEvent pour chaque message.
 * Retourne { connected, error }.
 */
export function useSse(url, onEvent, deps = []) {
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState(null)
  const esRef = useRef(null)

  useEffect(() => {
    if (!url) return
    setConnected(false)
    setError(null)

    const es = new EventSource(url)
    esRef.current = es

    es.onopen = () => setConnected(true)
    es.onmessage = e => {
      try {
        onEvent(JSON.parse(e.data))
      } catch (_) {}
    }
    es.onerror = () => {
      setError('Connexion perdue')
      setConnected(false)
      es.close()
    }

    return () => es.close()
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps

  return { connected, error }
}
