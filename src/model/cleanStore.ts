import { create } from 'zustand'
import { newCleanMap } from './hexa'
import * as ringedDocument from './ringedDocument'
import { CleanFileSchema, type CleanElement, type CleanEndpoint, type CleanFile, type CleanSector } from './schema'
import { boot } from './store'

type EndpointCollection = 'actors' | 'externals'

interface CleanState {
  map: CleanFile
  /** Bumps when the whole map is swapped, so the stage knows to refit — same contract as useMapStore's/useOnionStore's. */
  revision: number
  replace: (map: CleanFile) => void
  /** Undo: restores the map. `swap: true` bumps the revision like `replace` did (a whole-map swap); a plain item
   * edit leaves it alone — mirrors useOnionStore's `restore`. */
  restore: (snapshot: { map: CleanFile; swap?: boolean }) => void
  /** Adds a free, user-named sector to a ring (REQ-03) — any ring, any count including a repeat add on top of
   * existing ones; a sector references nothing yet, so this always succeeds. */
  addSector: (patch: Omit<CleanSector, 'id'>) => string
  /** Renames a sector in place — its ring never changes here (no such control is offered). */
  updateSector: (id: string, patch: Partial<Omit<CleanSector, 'id'>>) => void
  /** Removes a sector, cascade-pruning its own elements — and, through the shared `removeElement`, anything
   * referencing them — mirroring `removeElement`'s existing idiom. */
  removeSector: (id: string) => void
  /** Adds a named element into the given sector (REQ-04) — `sectorId` is required by the type, so there is no
   * direct-to-ring path through this store. */
  addElement: (patch: Omit<CleanElement, 'id'>) => string
  /** Patches an existing element (validate-by-reparse: a `sectorId` change to an unknown sector is rejected). */
  updateElement: (id: string, patch: Partial<Omit<CleanElement, 'id'>>) => void
  /** Removes an element, pruning any dependency it took part in and clearing any endpoint target pointing to it. */
  removeElement: (id: string) => void
  /** Creates a dependency from `fromId` to `toId` (ADR-02: validate-by-reparse, mirrors useOnionStore's own
   * addDependency) — undefined ⇒ no-op: the pair would point to a more outward ring, sector-transparent (REQ-06). */
  addDependency: (fromId: string, toId: string) => string | undefined
  removeDependency: (id: string) => void
  /** Adds an actor or external system (validate-by-reparse) — undefined ⇒ no-op: `targetId` is set but does not
   * resolve to an element in the outer ring (REQ-07). */
  addEndpoint: (collection: EndpointCollection, patch: Omit<CleanEndpoint, 'id'>) => string | undefined
  removeEndpoint: (collection: EndpointCollection, id: string) => void
}

// The persisted slot holds a single StoredFile of either kind — this store only boots into the Clean arm when
// that's what was saved; App.tsx picks which store's content is the active view (ADR-02).
const bootCleanMap: CleanFile = boot.map.kind === 'clean' ? boot.map : newCleanMap('Untitled architecture')

export const useCleanStore = create<CleanState>()((set, get) => ({
  map: bootCleanMap,
  revision: 0,
  replace: (map) => set({ map, revision: get().revision + 1 }),
  restore: ({ map, swap }) => set((s) => ({ map, revision: swap ? s.revision + 1 : s.revision })),
  addSector: (patch) => {
    const id = `sector-${crypto.randomUUID().slice(0, 8)}`
    set((s) => ({ map: { ...s.map, sectors: [...s.map.sectors, { ...patch, id }] } }))
    return id
  },
  updateSector: (id, patch) => {
    set((s) => ({ map: { ...s.map, sectors: s.map.sectors.map((sector) => (sector.id === id ? { ...sector, ...patch } : sector)) } }))
  },
  removeSector: (id) => {
    set((s) => {
      const withoutElements = s.map.elements
        .filter((e) => e.sectorId === id)
        .reduce((doc, e) => ringedDocument.removeElement(doc, e.id), s.map)
      return { map: { ...withoutElements, sectors: withoutElements.sectors.filter((sector) => sector.id !== id) } }
    })
  },
  addElement: (patch) => {
    const { doc, id } = ringedDocument.addElement<CleanFile, CleanElement>(get().map, patch, () => `element-${crypto.randomUUID().slice(0, 8)}`)
    set({ map: doc })
    return id
  },
  updateElement: (id, patch) => {
    const next = ringedDocument.updateElement<CleanFile, CleanElement>(get().map, id, patch, CleanFileSchema)
    if (!next) return
    set({ map: next })
  },
  removeElement: (id) => set({ map: ringedDocument.removeElement(get().map, id) }),
  addDependency: (fromId, toId) => {
    const result = ringedDocument.addDependency(get().map, fromId, toId, () => `dependency-${crypto.randomUUID().slice(0, 8)}`, CleanFileSchema)
    if (!result) return undefined
    set({ map: result.doc })
    return result.id
  },
  removeDependency: (id) => set({ map: ringedDocument.removeDependency(get().map, id) }),
  addEndpoint: (collection, patch) => {
    const makeId = () => `${collection === 'actors' ? 'actor' : 'external'}-${crypto.randomUUID().slice(0, 8)}`
    const result = ringedDocument.addEndpoint<CleanFile, CleanEndpoint>(get().map, collection, patch, makeId, CleanFileSchema)
    if (!result) return undefined
    set({ map: result.doc })
    return result.id
  },
  removeEndpoint: (collection, id) => set({ map: ringedDocument.removeEndpoint(get().map, collection, id) }),
}))
