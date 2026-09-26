import { create } from 'zustand'
import { newOnionMap } from './hexa'
import { OnionFileSchema, type OnionElement, type OnionEndpoint, type OnionFile } from './schema'
import { boot } from './store'
import { validated } from './validated'

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
    const id = `element-${crypto.randomUUID().slice(0, 8)}`
    set((s) => ({ map: { ...s.map, elements: [...s.map.elements, { ...patch, id }] } }))
    return id
  },
  updateElement: (id, patch) => {
    const candidate: OnionFile = { ...get().map, elements: get().map.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)) }
    const next = validated(OnionFileSchema, candidate)
    if (!next) return
    set({ map: next })
  },
  removeElement: (id) =>
    set((s) => ({
      map: {
        ...s.map,
        elements: s.map.elements.filter((e) => e.id !== id),
        dependencies: s.map.dependencies.filter((d) => d.fromId !== id && d.toId !== id),
        actors: s.map.actors.map((a) => (a.targetId === id ? { ...a, targetId: undefined } : a)),
        externals: s.map.externals.map((x) => (x.targetId === id ? { ...x, targetId: undefined } : x)),
      },
    })),
  addDependency: (fromId, toId) => {
    const id = `dependency-${crypto.randomUUID().slice(0, 8)}`
    const candidate: OnionFile = { ...get().map, dependencies: [...get().map.dependencies, { id, fromId, toId }] }
    const next = validated(OnionFileSchema, candidate)
    if (!next) return undefined
    set({ map: next })
    return id
  },
  removeDependency: (id) => set((s) => ({ map: { ...s.map, dependencies: s.map.dependencies.filter((d) => d.id !== id) } })),
  addEndpoint: (collection, patch) => {
    const id = `${collection === 'actors' ? 'actor' : 'external'}-${crypto.randomUUID().slice(0, 8)}`
    const candidate: OnionFile = { ...get().map, [collection]: [...get().map[collection], { ...patch, id }] }
    const next = validated(OnionFileSchema, candidate)
    if (!next) return undefined
    set({ map: next })
    return id
  },
  removeEndpoint: (collection, id) => set((s) => ({ map: { ...s.map, [collection]: s.map[collection].filter((e) => e.id !== id) } })),
}))
