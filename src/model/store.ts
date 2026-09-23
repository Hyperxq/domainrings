import { create } from 'zustand'
import { diagramOf, putDiagram } from './map'
import { browserStorage, loadMap } from './persistence'
import { REFERENCES, type CollectionKey, type Diagram, type HexaMap, type Hexagon, type Link, type Linkable } from './schema'

export type Item<K extends CollectionKey> = Diagram[K][number]
type HexagonMeta = Partial<Pick<Hexagon, 'title' | 'subtitle' | 'composition' | 'layers'>>
type MapMeta = Partial<Pick<HexaMap, 'title' | 'kind'>>

const NEW_ITEM: { [K in CollectionKey]: Omit<Item<K>, 'id'> } = {
  domain: { name: 'NewEntity', type: 'entity' },
  useCases: { name: 'NewUseCase' },
  ports: { name: 'newPort', side: 'driving' },
  adapters: { name: 'NewAdapter' },
  actors: { name: 'New actor' },
  externals: { name: 'New system' },
}

interface MapState {
  map: HexaMap
  /** The hexagon every edit and every "+" applies to. */
  focus: string
  /** Bumps when the whole map is swapped, so the stage knows to refit. */
  revision: number
  replace: (map: HexaMap) => void
  /** Undo: restores both the map and whichever hexagon was current at the time of the edit, without bumping revision. */
  restore: (snapshot: { map: HexaMap; focus: string }) => void
  setFocus: (hexId: string) => void
  setMapMeta: (meta: MapMeta) => void
  setMeta: (hexId: string, meta: HexagonMeta) => void
  addItem: <K extends CollectionKey>(hexId: string, key: K, patch?: Partial<Omit<Item<K>, 'id'>>) => string
  updateItem: <K extends CollectionKey>(hexId: string, key: K, id: string, patch: Partial<Omit<Item<K>, 'id'>>) => Link[]
  removeItem: (hexId: string, key: CollectionKey, id: string) => Link[]
}

// Computed keys widen to an index signature; this is the one place the collection type is re-asserted.
const withCollection = <K extends CollectionKey>(d: Diagram, key: K, items: Item<K>[]): Diagram =>
  ({ ...d, [key]: items }) as Diagram

export const boot = loadMap(browserStorage())

export const useMapStore = create<MapState>()((set, get) => {
  const editHexagon = (hexId: string, fn: (d: Diagram) => Diagram) =>
    set((s) => ({ map: putDiagram(s.map, hexId, fn(diagramOf(s.map, hexId))) }))
  return {
    map: boot.map,
    focus: boot.map.hexagons[0].id,
    revision: 0,
    replace: (map) => set({ map, focus: map.hexagons[0].id, revision: get().revision + 1 }),
    restore: ({ map, focus }) => set({ map, focus }),
    setFocus: (hexId) => set((s) => (s.map.hexagons.some((h) => h.id === hexId) ? { focus: hexId } : {})),
    setMapMeta: (meta) =>
      set((s) => (meta.kind && meta.kind !== 'hexagonal' && s.map.hexagons.length > 1 ? {} : { map: { ...s.map, ...meta } })),
    setMeta: (hexId, meta) => editHexagon(hexId, (d) => ({ ...d, ...meta })),
    addItem: (hexId, key, patch) => {
      const id = `${key}-${crypto.randomUUID().slice(0, 8)}`
      editHexagon(hexId, (d) => withCollection(d, key, [...d[key], { ...NEW_ITEM[key], ...patch, id } as Item<typeof key>]))
      return id
    },
    // Pruning links broken by this edit (SEAM-06) is a later slice's job — every edit returns no pruned links yet.
    updateItem: (hexId, key, id, patch) => {
      editHexagon(hexId, (d) => withCollection(d, key, (d[key] as Item<typeof key>[]).map((i) => (i.id === id ? { ...i, ...patch } : i))))
      return []
    },
    removeItem: (hexId, key, id) => {
      editHexagon(hexId, (d) => {
        let next = withCollection(d, key, (d[key] as Item<typeof key>[]).filter((i) => i.id !== id))
        for (const [owner, field, target] of REFERENCES) {
          if (target !== key) continue
          const items: Linkable[] = next[owner]
          next = withCollection(next, owner, items.map((i) => (i[field] === id ? { ...i, [field]: undefined } : i)) as Item<typeof owner>[])
        }
        return next
      })
      return []
    },
  }
})
