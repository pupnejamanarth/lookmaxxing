import { useEffect, useRef, useState, type DependencyList } from 'react'
import { watch } from '../store'

export interface LiveResult<T> {
  /** undefined until the first result arrives. Kept (stale) while a changed `deps` re-queries. */
  value: T | undefined
  loading: boolean
  error: Error | null
}

function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e))
}

/**
 * Subscribes to a Dexie live query: `querier` runs now and again whenever a table it read changes.
 * Re-subscribes when `deps` change (put anything the querier closes over in `deps`).
 * Do not write to the database inside `querier`.
 */
export function useLive<T>(querier: () => Promise<T> | T, deps: DependencyList = []): LiveResult<T> {
  const [state, setState] = useState<LiveResult<T>>({ value: undefined, loading: true, error: null })
  const latest = useRef(querier)
  latest.current = querier

  useEffect(() => {
    let active = true
    setState((s) => (s.loading ? s : { ...s, loading: true }))
    const unsubscribe = watch(() => latest.current()).subscribe(
      (value) => {
        if (active) setState({ value, loading: false, error: null })
      },
      (e) => {
        if (active) setState((s) => ({ value: s.value, loading: false, error: toError(e) }))
      },
    )
    return () => {
      active = false
      unsubscribe()
    }
  }, deps)

  return state
}
