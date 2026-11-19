import { useRef, useState } from 'react'

type Handlers = Record<string, (...args: never[]) => unknown>

/** Stable stand-ins for this render's callbacks, so a memoized child keeps them without going stale. */
export function useStable<T extends Handlers>(handlers: T): T {
  const latest = useRef(handlers)
  latest.current = handlers
  const [stable] = useState(
    () => Object.fromEntries(Object.keys(handlers).map(k => [k, (...args: never[]) => latest.current[k](...args)])) as T,
  )
  return stable
}

/** `value`, or the last render's when `same` says it hasn't changed: a memoized child keeps it. */
export function useSame<T>(value: T, same: (a: T, b: T) => boolean): T {
  const kept = useRef(value)
  if (!same(kept.current, value)) kept.current = value
  return kept.current
}
