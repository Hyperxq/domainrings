import type { StoreApi } from 'zustand/vanilla'
import { EXAMPLE_DIAGRAM, RETIRED_SEEDS, SEED_VERSION } from './example'
import { parseHexa, toHexa } from './hexa'
import { APP, type Diagram } from './schema'

export const STORAGE_KEY = 'domainrings:diagram'

/** The stored envelope is the .hexa file plus the seed version it was written under. */
const serialise = (diagram: Diagram) => JSON.stringify({ app: APP, seedVersion: SEED_VERSION, ...diagram }, null, 2)

export function loadDiagram(storage: Pick<Storage, 'getItem'> | undefined): Diagram {
  try {
    const text = storage?.getItem(STORAGE_KEY)
    const result = text ? parseHexa(text) : undefined
    if (!result?.ok) return EXAMPLE_DIAGRAM
    // An autosave from an older seed version that still equals that seed byte for byte was never edited.
    const stale =
      JSON.parse(text!).seedVersion !== SEED_VERSION &&
      RETIRED_SEEDS.some((seed) => toHexa(seed) === toHexa(result.diagram))
    return stale ? EXAMPLE_DIAGRAM : result.diagram
  } catch {
    return EXAMPLE_DIAGRAM
  }
}

export function autosave(
  store: StoreApi<{ diagram: Diagram }>,
  storage: Pick<Storage, 'setItem'>,
  delay = 400,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const unsubscribe = store.subscribe((next, prev) => {
    if (next.diagram === prev.diagram) return
    clearTimeout(timer)
    timer = setTimeout(() => {
      try {
        storage.setItem(STORAGE_KEY, serialise(store.getState().diagram))
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

// The store reads the diagram at import time, so the migration lives in the one gateway every reader goes through.
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
