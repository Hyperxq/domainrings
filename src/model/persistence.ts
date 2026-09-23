import type { StoreApi } from 'zustand/vanilla'
import { EXAMPLE_DIAGRAM } from './example'
import { parseHexa, toHexa, toMap } from './hexa'
import type { HexaMap } from './schema'

export const MAP_KEY = 'domainrings:map'
/** Read-only: what the previous, single-hexagon version wrote. The full v1/legacy fallback chain lands in the next slice. */
export const V1_KEY = 'domainrings:diagram'

export type Recovery = 'none' | 'kept' | 'not-kept'

export interface LoadResult {
  map: HexaMap
  recovery: Recovery
  unreadableText?: string
}

/**
 * S-000: reads this version's own slot, or falls back to the built-in example. The v1/legacy fallback chain
 * (AUTO-01) and the unreadable-copy recovery path (AUTO-03) are a later slice's job — `recovery` stays 'none'
 * here so the type is honest without faking behaviour this slice does not implement yet.
 */
export function loadMap(storage: Pick<Storage, 'getItem'> | undefined): LoadResult {
  try {
    const text = storage?.getItem(MAP_KEY)
    const result = text ? parseHexa(text) : undefined
    if (result?.ok) return { map: result.map, recovery: 'none' }
  } catch {
    // Falls through to the example below.
  }
  return { map: toMap(EXAMPLE_DIAGRAM), recovery: 'none' }
}

export function autosave(
  store: StoreApi<{ map: HexaMap }>,
  storage: Pick<Storage, 'setItem'>,
  recovery: Recovery,
  delay = 400,
): () => void {
  if (recovery === 'not-kept') return () => {}
  let timer: ReturnType<typeof setTimeout> | undefined
  const unsubscribe = store.subscribe((next, prev) => {
    if (next.map === prev.map) return
    clearTimeout(timer)
    timer = setTimeout(() => {
      try {
        storage.setItem(MAP_KEY, toHexa(store.getState().map))
      } catch {
        // Quota or privacy-mode failures only cost the autosave, never the session.
      }
    }, delay)
  })
  return () => {
    clearTimeout(timer)
    unsubscribe()
  }
}

const LEGACY_PREFIX = 'archviz:'

/** Keys written before the rename move to the new prefix; a value already under the new name wins. */
function migrateLegacyKeys(storage: Storage) {
  const legacy = Object.keys(storage).filter((key) => key.startsWith(LEGACY_PREFIX))
  for (const old of legacy) {
    const key = `domainrings:${old.slice(LEGACY_PREFIX.length)}`
    if (storage.getItem(key) === null) storage.setItem(key, storage.getItem(old)!)
    storage.removeItem(old)
  }
}

// The store reads the map at import time, so the migration lives in the one gateway every reader goes through.
export function browserStorage(): Storage | undefined {
  let storage: Storage
  try {
    storage = window.localStorage
  } catch {
    return undefined
  }
  try {
    migrateLegacyKeys(storage)
  } catch {
    // A full quota leaves the legacy keys for the next boot.
  }
  return storage
}
