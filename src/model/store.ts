import { create } from 'zustand'
import { diagramOf, freeCell, freeSides, neighbour, placeHexagon, putDiagram, pruneLinks, removeHexagon as removeHexagonFromMap, UNTITLED_HEXAGON } from './map'
import { browserStorage, loadMap } from './persistence'
import { REFERENCES, type CollectionKey, type Diagram, type HexaMap, type Hexagon, type Link, type Linkable, type Wall } from './schema'

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
  /** Undo: restores both the map and whichever hexagon was current at the time of the edit. An item edit leaves the
   * revision alone (link mode and the view survive); undoing a whole-map swap (`swap: true`) bumps it like `replace`
   * did, so the view refits and link mode ends. */
  restore: (snapshot: { map: HexaMap; focus: string; swap?: boolean }) => void
  setFocus: (hexId: string) => void
  setMapMeta: (meta: MapMeta) => void
  setMeta: (hexId: string, meta: HexagonMeta) => void
  addItem: <K extends CollectionKey>(hexId: string, key: K, patch?: Partial<Omit<Item<K>, 'id'>>) => string
  updateItem: <K extends CollectionKey>(hexId: string, key: K, id: string, patch: Partial<Omit<Item<K>, 'id'>>) => Link[]
  removeItem: (hexId: string, key: CollectionKey, id: string) => Link[]
  /** Grows the map from `from`'s given (or first free, in SIDE_ORDER) side, into that hexagon's own context or a
   * fresh one. Undefined — a no-op — when `from` has no free side, or the map isn't hexagonal and `convert` isn't
   * set (ADR-02). Focuses the new hexagon; never bumps `revision`. */
  addHexagon: (from: string, opts: { side?: Wall; context: 'same' | 'new'; convert?: boolean }) => string | undefined
  /** Imports `file`'s one hexagon onto the first free cell from the current hexagon, into its own context or a
   * fresh one — sharing `addHexagon`'s destination vocabulary and the same write path (ADR-02). Undefined when
   * `file` does not hold exactly one hexagon (IMP-04), or the map isn't hexagonal and `convert` isn't set. Focuses
   * the imported hexagon; never bumps `revision`. */
  importHexagon: (file: HexaMap, opts: { context: 'same' | 'new'; convert?: boolean }) => string | undefined
  /** Removes `hexId`, pruning its links and dropping its own now-empty context; moves focus to `hexagons[0]` when
   * the deleted one was current. No-op ([]), leaving the map untouched, on the map's last hexagon (DEL-01) — a
   * map is never left with zero. Never bumps `revision`. */
  removeHexagon: (hexId: string) => Link[]
}

// Computed keys widen to an index signature; this is the one place the collection type is re-asserted.
const withCollection = <K extends CollectionKey>(d: Diagram, key: K, items: Item<K>[]): Diagram =>
  ({ ...d, [key]: items }) as Diagram

export const boot = loadMap(browserStorage())

export const useMapStore = create<MapState>()((set, get) => {
  const editHexagon = (hexId: string, fn: (d: Diagram) => Diagram) =>
    set((s) => ({ map: putDiagram(s.map, hexId, fn(diagramOf(s.map, hexId))) }))
  // Pruning links broken by this edit (SEAM-06): every hexId edit that can invalidate a port re-checks the map's
  // links afterward, dropping the ones that no longer stand and reporting them to the caller.
  const editAndPrune = (hexId: string, fn: (d: Diagram) => Diagram) => {
    editHexagon(hexId, fn)
    const { map, pruned } = pruneLinks(get().map, hexId)
    set({ map })
    return pruned
  }
  return {
    map: boot.map,
    focus: boot.map.hexagons[0].id,
    revision: 0,
    replace: (map) => set({ map, focus: map.hexagons[0].id, revision: get().revision + 1 }),
    restore: ({ map, focus, swap }) => set((s) => ({ map, focus, revision: swap ? s.revision + 1 : s.revision })),
    setFocus: (hexId) => set((s) => (s.map.hexagons.some((h) => h.id === hexId) ? { focus: hexId } : {})),
    setMapMeta: (meta) =>
      set((s) => (meta.kind && meta.kind !== 'hexagonal' && s.map.hexagons.length > 1 ? {} : { map: { ...s.map, ...meta } })),
    setMeta: (hexId, meta) => editHexagon(hexId, (d) => ({ ...d, ...meta })),
    addItem: (hexId, key, patch) => {
      const id = `${key}-${crypto.randomUUID().slice(0, 8)}`
      editHexagon(hexId, (d) => withCollection(d, key, [...d[key], { ...NEW_ITEM[key], ...patch, id } as Item<typeof key>]))
      return id
    },
    updateItem: (hexId, key, id, patch) =>
      editAndPrune(hexId, (d) => withCollection(d, key, (d[key] as Item<typeof key>[]).map((i) => (i.id === id ? { ...i, ...patch } : i)))),
    removeItem: (hexId, key, id) =>
      editAndPrune(hexId, (d) => {
        let next = withCollection(d, key, (d[key] as Item<typeof key>[]).filter((i) => i.id !== id))
        for (const [owner, field, target] of REFERENCES) {
          if (target !== key) continue
          const items: Linkable[] = next[owner]
          next = withCollection(next, owner, items.map((i) => (i[field] === id ? { ...i, [field]: undefined } : i)) as Item<typeof owner>[])
        }
        return next
      }),
    addHexagon: (from, { side, context, convert }) => {
      const map = get().map
      const source = map.hexagons.find((h) => h.id === from)
      if (!source || (map.kind !== 'hexagonal' && !convert)) return undefined
      const growSide = side ?? freeSides(map, source.cell)[0]
      if (growSide === undefined) return undefined
      const view: Diagram = { version: 1, kind: 'hexagonal', title: UNTITLED_HEXAGON, domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [] }
      const { map: next, hexId } = placeHexagon(map, view, { cell: neighbour(source.cell, growSide), contextId: context === 'same' ? source.contextId : undefined })
      set({ map: next, focus: hexId })
      return hexId
    },
    importHexagon: (file, { context, convert }) => {
      if (file.hexagons.length !== 1) return undefined
      const map = get().map
      if (map.kind !== 'hexagonal' && !convert) return undefined
      const current = map.hexagons.find((h) => h.id === get().focus)!
      const view = diagramOf(file, file.hexagons[0].id)
      const { map: next, hexId } = placeHexagon(map, view, { cell: freeCell(map, current.cell), contextId: context === 'same' ? current.contextId : undefined })
      set({ map: next, focus: hexId })
      return hexId
    },
    removeHexagon: (hexId) => {
      const map = get().map
      if (map.hexagons.length <= 1) return []
      const { map: next, pruned } = removeHexagonFromMap(map, hexId)
      set({ map: next, focus: get().focus === hexId ? next.hexagons[0].id : get().focus })
      return pruned
    },
  }
})
