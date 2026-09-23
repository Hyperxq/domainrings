import type { StoreApi } from 'zustand/vanilla'
import { EXAMPLE_DIAGRAM, RETIRED_SEEDS, SEED_VERSION } from './example'
import { parseHexa, toHexa, toMap } from './hexa'
import type { Diagram, HexaMap } from './schema'

export const MAP_KEY = 'domainrings:map'
export const UNREADABLE_KEY = 'domainrings:map.unreadable'
/** Read-only: what the previous, single-hexagon version wrote. Never written to or removed (ADR-03) — a
 *  rollback to that build must find it exactly as it left it. */
export const V1_KEY = 'domainrings:diagram'
/** Read-only: what the version before the domainrings rename wrote. Never migrated into `V1_KEY` (ADR-03) —
 *  moving it would let the current build silently claim the old build's saved place. */
export const LEGACY_KEY = 'archviz:diagram'

export type Recovery = 'none' | 'kept' | 'not-kept'

export interface LoadResult {
  map: HexaMap
  recovery: Recovery
  unreadableText?: string
}

function safeText(storage: Pick<Storage, 'getItem'> | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null
  } catch {
    return null
  }
}

/** An autosave from an older seed version that still equals that seed, byte for byte, was never edited. */
function staleUpgrade(text: string, diagram: Diagram): HexaMap | undefined {
  let seedVersion: unknown
  try {
    seedVersion = JSON.parse(text).seedVersion
  } catch {
    return undefined
  }
  if (seedVersion === SEED_VERSION) return undefined
  const stale = RETIRED_SEEDS.some((seed) => JSON.stringify(seed) === JSON.stringify(diagram))
  return stale ? toMap(EXAMPLE_DIAGRAM) : undefined
}

/** Reads a read-only v1-shaped fallback slot (`V1_KEY` or `LEGACY_KEY`), applying the stale-seed check. */
function readFallbackSlot(storage: Pick<Storage, 'getItem'> | undefined, key: string): HexaMap | undefined {
  const text = safeText(storage, key)
  if (!text) return undefined
  const result = parseHexa(text)
  if (!result.ok || !result.v1) return undefined
  return staleUpgrade(text, result.v1) ?? result.map
}

/** Keeps a read-back-verified copy of unreadable own-slot text, skipping the write when it already matches. */
function recoverUnreadable(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined, text: string): LoadResult {
  try {
    if (storage?.getItem(UNREADABLE_KEY) !== text) storage?.setItem(UNREADABLE_KEY, text)
    if (storage?.getItem(UNREADABLE_KEY) !== text) throw new Error('the copy did not persist')
    return { map: toMap(EXAMPLE_DIAGRAM), recovery: 'kept', unreadableText: text }
  } catch {
    return { map: toMap(EXAMPLE_DIAGRAM), recovery: 'not-kept' }
  }
}

/**
 * Reads this version's own slot; if it is unreadable, keeps a copy and shows the example (AUTO-03), never
 * falling through to the v1 slot. If the own slot is empty, falls back through the v1 slot then the legacy
 * (pre-rename) slot — migrating and applying the stale-seed check to whichever it finds first (AUTO-01/02) —
 * before showing the example.
 */
export function loadMap(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined): LoadResult {
  const ownText = safeText(storage, MAP_KEY)
  if (ownText) {
    const result = parseHexa(ownText)
    if (result.ok) return { map: result.map, recovery: 'none' }
    return recoverUnreadable(storage, ownText)
  }
  const fallback = readFallbackSlot(storage, V1_KEY) ?? readFallbackSlot(storage, LEGACY_KEY)
  return { map: fallback ?? toMap(EXAMPLE_DIAGRAM), recovery: 'none' }
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

/** Keys written before the rename move to the new prefix; a value already under the new name wins.
 *  `LEGACY_KEY` is exempted (ADR-03): it stays a read-only fallback, never moved or deleted. */
function migrateLegacyKeys(storage: Storage) {
  const legacy = Object.keys(storage).filter((key) => key.startsWith(LEGACY_PREFIX) && key !== LEGACY_KEY)
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
