import { create } from 'zustand'
import { newCleanMap } from './hexa'
import { type CleanFile } from './schema'
import { boot } from './store'

interface CleanState {
  map: CleanFile
  /** Bumps when the whole map is swapped, so the stage knows to refit — same contract as useMapStore's/useOnionStore's. */
  revision: number
  replace: (map: CleanFile) => void
  /** Undo: restores the map. `swap: true` bumps the revision like `replace` did (a whole-map swap); a plain item
   * edit leaves it alone — mirrors useOnionStore's `restore`. */
  restore: (snapshot: { map: CleanFile; swap?: boolean }) => void
}

// The persisted slot holds a single StoredFile of either kind — this store only boots into the Clean arm when
// that's what was saved; App.tsx picks which store's content is the active view (ADR-02).
const bootCleanMap: CleanFile = boot.map.kind === 'clean' ? boot.map : newCleanMap('Untitled architecture')

export const useCleanStore = create<CleanState>()((set, get) => ({
  map: bootCleanMap,
  revision: 0,
  replace: (map) => set({ map, revision: get().revision + 1 }),
  restore: ({ map, swap }) => set((s) => ({ map, revision: swap ? s.revision + 1 : s.revision })),
}))
