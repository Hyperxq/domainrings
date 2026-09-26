import { create } from 'zustand'
import { newOnionMap } from './hexa'
import { boot } from './store'
import type { OnionFile } from './schema'

interface OnionState {
  map: OnionFile
  /** Bumps when the whole map is swapped, so the stage knows to refit — same contract as useMapStore's. */
  revision: number
  replace: (map: OnionFile) => void
  /** Undo: restores the map. `swap: true` bumps the revision like `replace` did (a whole-map swap); a plain item
   * edit leaves it alone — mirrors useMapStore's `restore`. */
  restore: (snapshot: { map: OnionFile; swap?: boolean }) => void
}

// The persisted slot holds a single StoredFile of either kind — this store only boots into the Onion arm when
// that's what was saved; App.tsx picks which store's content is the active view (ADR-02).
const bootOnionMap: OnionFile = boot.map.kind === 'onion' ? boot.map : newOnionMap('Untitled architecture')

export const useOnionStore = create<OnionState>()((set, get) => ({
  map: bootOnionMap,
  revision: 0,
  replace: (map) => set({ map, revision: get().revision + 1 }),
  restore: ({ map, swap }) => set((s) => ({ map, revision: swap ? s.revision + 1 : s.revision })),
}))
