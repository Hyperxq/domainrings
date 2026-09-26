import { create } from 'zustand'
import { addLink as addLinkToMap, diagramOf, freeCell, freeSides, neighbour, placeHexagon, putDiagram, pruneLinks, removeHexagon as removeHexagonFromMap, removeLink as removeLinkFromMap, UNTITLED_HEXAGON, updateLink as updateLinkOnMap, type Cell, type Destination, type LinkPatch } from './map'
import { EXAMPLE_DIAGRAM } from './example'
import { toMap } from './hexa'
import { browserStorage, loadMap } from './persistence'
import { MapSchema, REFERENCES, type CollectionKey, type Diagram, type HexaMap, type Hexagon, type Link, type LinkEnd, type Linkable, type Wall } from './schema'

export type Item<K extends CollectionKey> = Diagram[K][number]
type HexagonMeta = Partial<Pick<Hexagon, 'title' | 'subtitle' | 'composition' | 'layers'>>
// `kind` is immutable once a file exists (REQ-01) — no longer settable here.
type MapMeta = Partial<Pick<HexaMap, 'title'>>

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
   * fresh one. Undefined — a no-op — when `from` has no free side. Focuses the new hexagon; never bumps `revision`. */
  addHexagon: (from: string, opts: { side?: Wall; context: Destination }) => string | undefined
  /** Imports `file`'s one hexagon onto the first free cell from the current hexagon, into its own context or a
   * fresh one — sharing `addHexagon`'s destination vocabulary and the same write path (ADR-02). Undefined when
   * `file` does not hold exactly one hexagon (IMP-04). Focuses the imported hexagon; never bumps `revision`. */
  importHexagon: (file: HexaMap, opts: { context: Destination }) => string | undefined
  /** Removes `hexId`, pruning its links and dropping its own now-empty context; moves focus to `hexagons[0]` when
   * the deleted one was current. No-op ([]), leaving the map untouched, on the map's last hexagon (DEL-01) — a
   * map is never left with zero. Never bumps `revision`. */
  removeHexagon: (hexId: string) => Link[]
  /** Sets or clears `contextId`'s display name; `''` removes the `name` key entirely rather than storing an empty
   * string, so a cleared context falls back to its "Context {n}" placeholder (NAME-02.3). Every other context is
   * untouched; never bumps `revision`. */
  setContextName: (contextId: string, name: string) => void
  /** Creates a link from `from` to `to` (ADR-02: validate-by-reparse) — the candidate map is built then gated by
   * MapSchema.safeParse, reusing checkMap's own driven/driving, duplicate-pair and pattern-eligibility rules
   * instead of re-implementing them. Undefined ⇒ no-op, the map already failed schema and is left unchanged.
   * Never bumps `revision`. */
  addLink: (from: LinkEnd, to: LinkEnd) => string | undefined
  /** Patches an existing link's adapters and/or pattern (ADR-02: validate-by-reparse, same shape as addLink) and
   * returns it updated — undefined ⇒ no-op: no link has `id`, or the patched candidate map failed MapSchema (e.g.
   * an adapter not on that port, or a pattern on a same-context link, REQ-LNK-06.2). Never bumps `revision`. */
  updateLink: (id: string, patch: LinkPatch) => Link | undefined
  /** Removes an existing link, returning it (for the undo toast's message) — undefined ⇒ no such link, the map is
   * untouched. Never prunes any OTHER link (links are never referenced by another link). Never bumps `revision`. */
  removeLink: (id: string) => Link | undefined
}

// Computed keys widen to an index signature; this is the one place the collection type is re-asserted.
const withCollection = <K extends CollectionKey>(d: Diagram, key: K, items: Item<K>[]): Diagram =>
  ({ ...d, [key]: items }) as Diagram

export const boot = loadMap(browserStorage())
// The persisted slot holds a single saved document of either architecture — this store only ever boots into
// its Hexagonal shape; App.tsx picks which store's content is the active view (ADR-02), independent of boot.
const bootHexaMap: HexaMap = boot.map.kind === 'hexagonal' ? boot.map : toMap(EXAMPLE_DIAGRAM)

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
  // Single placement path for addHexagon/importHexagon (ADR-02): both resolve their own cell/source, then share
  // the placeHexagon call and the focus-setting write.
  const placeAndFocus = (map: HexaMap, view: Diagram, cell: Cell, contextId: string | undefined): string | undefined => {
    const { map: next, hexId } = placeHexagon(map, view, { cell, contextId })
    set({ map: next, focus: hexId })
    return hexId
  }
  return {
    map: bootHexaMap,
    focus: bootHexaMap.hexagons[0].id,
    revision: 0,
    replace: (map) => set({ map, focus: map.hexagons[0].id, revision: get().revision + 1 }),
    restore: ({ map, focus, swap }) => set((s) => ({ map, focus, revision: swap ? s.revision + 1 : s.revision })),
    setFocus: (hexId) => set((s) => (s.map.hexagons.some((h) => h.id === hexId) ? { focus: hexId } : {})),
    setMapMeta: (meta) => set((s) => ({ map: { ...s.map, ...meta } })),
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
    addHexagon: (from, { side, context }) => {
      const map = get().map
      const source = map.hexagons.find((h) => h.id === from)
      if (!source) return undefined
      const growSide = side ?? freeSides(map, source.cell)[0]
      if (growSide === undefined) return undefined
      const view: Diagram = { version: 1, kind: 'hexagonal', title: UNTITLED_HEXAGON, domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [] }
      return placeAndFocus(map, view, neighbour(source.cell, growSide), context === 'same' ? source.contextId : undefined)
    },
    importHexagon: (file, { context }) => {
      if (file.hexagons.length !== 1) return undefined
      const map = get().map
      const current = map.hexagons.find((h) => h.id === get().focus)!
      const view = diagramOf(file, file.hexagons[0].id)
      return placeAndFocus(map, view, freeCell(map, current.cell), context === 'same' ? current.contextId : undefined)
    },
    removeHexagon: (hexId) => {
      const map = get().map
      if (map.hexagons.length <= 1) return []
      const { map: next, pruned } = removeHexagonFromMap(map, hexId)
      set({ map: next, focus: get().focus === hexId ? next.hexagons[0].id : get().focus })
      return pruned
    },
    setContextName: (contextId, name) =>
      set((s) => ({
        map: {
          ...s.map,
          contexts: s.map.contexts.map((c) => (c.id !== contextId ? c : name ? { ...c, name } : { id: c.id })),
        },
      })),
    addLink: (from, to) => {
      const { map: next, linkId } = addLinkToMap(get().map, from, to)
      if (!MapSchema.safeParse(next).success) return undefined
      set({ map: next })
      return linkId
    },
    updateLink: (id, patch) => {
      if (!get().map.links.some((l) => l.id === id)) return undefined
      const next = updateLinkOnMap(get().map, id, patch)
      if (!MapSchema.safeParse(next).success) return undefined
      set({ map: next })
      return next.links.find((l) => l.id === id)
    },
    removeLink: (id) => {
      const result = removeLinkFromMap(get().map, id)
      if (!result) return undefined
      set({ map: result.map })
      return result.removed
    },
  }
})
