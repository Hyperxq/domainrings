import { create } from 'zustand'
import { newOnionMap } from './hexa'
import * as ringedDocument from './ringedDocument'
import { OnionFileSchema, type OnionElement, type OnionEndpoint, type OnionFile } from './schema'
import { boot } from './store'

type EndpointCollection = 'actors' | 'externals'

interface OnionState {
  map: OnionFile
  /** Bumps when the whole map is swapped, so the stage knows to refit — same contract as useMapStore's. */
  revision: number
  replace: (map: OnionFile) => void
  /** Undo: restores the map. `swap: true` bumps the revision like `replace` did (a whole-map swap); a plain item
   * edit leaves it alone — mirrors useMapStore's `restore`. */
  restore: (snapshot: { map: OnionFile; swap?: boolean }) => void
  /** Adds a named element to the given ring (REQ-07) — any ring accepts any element, no type bound to it. */
  addElement: (patch: Omit<OnionElement, 'id'>) => string
  /** Patches an existing element (validate-by-reparse: a `ringRole` change that would break an existing
   * dependency or endpoint target is rejected, i.e. no-op). */
  updateElement: (id: string, patch: Partial<Omit<OnionElement, 'id'>>) => void
  /** Removes an element, pruning any dependency it took part in and clearing any endpoint target pointing to it —
   * both would otherwise leave the document referencing an element that no longer exists. */
  removeElement: (id: string) => void
  /** Creates a dependency from `fromId` to `toId` (ADR-02: validate-by-reparse, same idiom as useMapStore's
   * addLink) — undefined ⇒ no-op: the pair would point to a more outward ring (REQ-04). */
  addDependency: (fromId: string, toId: string) => string | undefined
  removeDependency: (id: string) => void
  /** Adds an actor or external system (validate-by-reparse) — undefined ⇒ no-op: `targetId` is set but does not
   * resolve to an outer-ring element (REQ-05). */
  addEndpoint: (collection: EndpointCollection, patch: Omit<OnionEndpoint, 'id'>) => string | undefined
  removeEndpoint: (collection: EndpointCollection, id: string) => void
}

// The persisted slot holds a single StoredFile of either kind — this store only boots into the Onion arm when
// that's what was saved; App.tsx picks which store's content is the active view (ADR-02).
const bootOnionMap: OnionFile = boot.map.kind === 'onion' ? boot.map : newOnionMap('Untitled architecture')

export const useOnionStore = create<OnionState>()((set, get) => ({
  map: bootOnionMap,
  revision: 0,
  replace: (map) => set({ map, revision: get().revision + 1 }),
  restore: ({ map, swap }) => set((s) => ({ map, revision: swap ? s.revision + 1 : s.revision })),
  addElement: (patch) => {
    const { doc, id } = ringedDocument.addElement<OnionFile, OnionElement>(get().map, patch, () => `element-${crypto.randomUUID().slice(0, 8)}`)
    set({ map: doc })
    return id
  },
  updateElement: (id, patch) => {
    const next = ringedDocument.updateElement<OnionFile, OnionElement>(get().map, id, patch, OnionFileSchema)
    if (!next) return
    set({ map: next })
  },
  removeElement: (id) => set({ map: ringedDocument.removeElement(get().map, id) }),
  addDependency: (fromId, toId) => {
    const result = ringedDocument.addDependency(get().map, fromId, toId, () => `dependency-${crypto.randomUUID().slice(0, 8)}`, OnionFileSchema)
    if (!result) return undefined
    set({ map: result.doc })
    return result.id
  },
  removeDependency: (id) => set({ map: ringedDocument.removeDependency(get().map, id) }),
  addEndpoint: (collection, patch) => {
    const makeId = () => `${collection === 'actors' ? 'actor' : 'external'}-${crypto.randomUUID().slice(0, 8)}`
    const result = ringedDocument.addEndpoint<OnionFile, OnionEndpoint>(get().map, collection, patch, makeId, OnionFileSchema)
    if (!result) return undefined
    set({ map: result.doc })
    return result.id
  },
  removeEndpoint: (collection, id) => set({ map: ringedDocument.removeEndpoint(get().map, collection, id) }),
}))
