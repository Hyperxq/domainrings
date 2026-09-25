import { linkEndProblem, type Diagram, type HexaMap, type Hexagon, type Link, type LinkEnd, type Side, type Wall } from './schema'

/** Shown wherever a hexagon's title is displayed or exported but was left blank. */
export const UNTITLED_HEXAGON = 'Untitled hexagon'

export type Cell = Hexagon['cell']

/** Where a grown or imported hexagon lands: its source's own context, or a fresh one. */
export type Destination = 'same' | 'new'

/** Clockwise on screen (y down), starting east: the pinned search order for grow-by-button and import. */
export const SIDE_ORDER: readonly Wall[] = ['e', 'se', 'sw', 'w', 'nw', 'ne']

/** Axial pointy-top neighbour deltas, matching `cellCentre`'s `{x: pitch.x·(q+r/2), y: pitch.y·r}` skew:
 * e(+1,0) w(-1,0) ne(+1,-1) nw(0,-1) se(0,+1) sw(-1,+1). */
const NEIGHBOUR_DELTA: Record<Wall, Cell> = { e: { q: 1, r: 0 }, w: { q: -1, r: 0 }, ne: { q: 1, r: -1 }, nw: { q: 0, r: -1 }, se: { q: 0, r: 1 }, sw: { q: -1, r: 1 } }

export function neighbour(cell: Cell, side: Wall): Cell {
  const d = NEIGHBOUR_DELTA[side]
  return { q: cell.q + d.q, r: cell.r + d.r }
}

/** Satisfied by both `HexaMap` and `MapLayout` — just enough to know which cells are taken. */
type Occupancy = { hexagons: readonly { cell: Cell }[] }

const isFree = (map: Occupancy, cell: Cell) => !map.hexagons.some((h) => h.cell.q === cell.q && h.cell.r === cell.r)

/** Free sides of `from`, in `SIDE_ORDER`, for a hexagon growing at that cell. */
export function freeSides(map: Occupancy, from: Cell): Wall[] {
  return SIDE_ORDER.filter((side) => isFree(map, neighbour(from, side)))
}

/** The nearest free cell to `from`, searching outward ring by ring (ring k = the 6k cells at hex-distance k).
 * Ring k: start at `from + k·e`, walk k steps each of sw, w, nw, ne, e, se, checking before every step — the
 * walk traces exactly the ring's 6k cells once each. Terminates by ring ≤ the map's own hexagon count (a ring's
 * cell count already exceeds it well before then, so a free cell always exists inside that bound). */
export function freeCell(map: Occupancy, from: Cell): Cell {
  const maxRing = map.hexagons.length + 1
  for (let k = 1; k <= maxRing; k++) {
    let cell: Cell = { q: from.q + k, r: from.r }
    for (const side of ['sw', 'w', 'nw', 'ne', 'e', 'se'] as const) {
      for (let step = 0; step < k; step++) {
        if (isFree(map, cell)) return cell
        cell = neighbour(cell, side)
      }
    }
  }
  throw new Error('No free cell found within the search bound')
}

/** `${prefix}${max numeric suffix + 1}`; ids that don't match the prefix are ignored (ADR-03). */
export function nextId(ids: readonly string[], prefix: 'h' | 'c' | 'link'): string {
  const pattern = new RegExp(`^${prefix}(\\d+)$`)
  const max = ids.reduce((max, id) => Math.max(max, Number(pattern.exec(id)?.[1] ?? 0)), 0)
  return `${prefix}${max + 1}`
}

/** The stable "Context {n}" placeholder for a context: its id's numeric suffix, else its 1-based position among
 * the map's contexts (ADR-03) — fixed while the context exists (CB-03.2), regardless of whether it has a name. */
export function contextOrdinal(map: Pick<HexaMap, 'contexts'>, contextId: string): string {
  const index = map.contexts.findIndex((c) => c.id === contextId)
  const suffix = /^c(\d+)$/.exec(contextId)?.[1]
  return `Context ${suffix ?? index + 1}`
}

/** A context's display name: its own name, else its ordinal placeholder (ADR-03). */
export function contextName(map: Pick<HexaMap, 'contexts'>, contextId: string): string {
  const context = map.contexts.find((c) => c.id === contextId)
  return context?.name || contextOrdinal(map, contextId)
}

/** Appends a hexagon built from a Diagram view (version/kind dropped, like `putDiagram`) on `at.cell`, in the
 * existing `at.contextId` or — when omitted — a new context appended in the same transition, so the map never
 * holds a context with zero hexagons. Always returns kind 'hexagonal' (ADR-02). */
export function placeHexagon(map: HexaMap, view: Diagram, at: { cell: Cell; contextId?: string }): { map: HexaMap; hexId: string } {
  const hexId = nextId(map.hexagons.map((h) => h.id), 'h')
  const { version: _version, kind: _kind, ...fields } = view
  const contexts = at.contextId !== undefined ? map.contexts : [...map.contexts, { id: nextId(map.contexts.map((c) => c.id), 'c') }]
  const contextId = at.contextId ?? contexts[contexts.length - 1].id
  const hexagon: Hexagon = { id: hexId, contextId, cell: at.cell, ...fields }
  return { map: { ...map, kind: 'hexagonal', contexts, hexagons: [...map.hexagons, hexagon] }, hexId }
}

/** Removes `hexId`, every link with either end on it, and — only when it was that hexagon's own context and now
 * holds none — that context. A foreign context that already had none of its own is left alone (ADR-03 E2: the
 * freed hexagon/context ids may be reused by the next `nextId` call). */
export function removeHexagon(map: HexaMap, hexId: string): { map: HexaMap; pruned: Link[] } {
  const removed = map.hexagons.find((h) => h.id === hexId)!
  const hexagons = map.hexagons.filter((h) => h.id !== hexId)
  const pruned = map.links.filter((l) => l.from.hexagonId === hexId || l.to.hexagonId === hexId)
  const links = map.links.filter((l) => l.from.hexagonId !== hexId && l.to.hexagonId !== hexId)
  const contextEmptied = !hexagons.some((h) => h.contextId === removed.contextId)
  const contexts = contextEmptied ? map.contexts.filter((c) => c.id !== removed.contextId) : map.contexts
  return { map: { ...map, hexagons, links, contexts }, pruned }
}

/** The v1-shaped view of one hexagon, for every consumer still typed on `Diagram` (layout, insertion, links, legend). */
export function diagramOf(map: HexaMap, hexId: string): Diagram {
  const hexagon = map.hexagons.find((h) => h.id === hexId)
  if (!hexagon) throw new Error(`Unknown hexagon id "${hexId}"`)
  const { id: _id, contextId: _contextId, cell: _cell, ...fields } = hexagon
  return { version: 1, kind: map.kind, ...fields }
}

/** Writes a `Diagram` edit back onto its hexagon, dropping the fields that live on the map instead. */
export function putDiagram(map: HexaMap, hexId: string, diagram: Diagram): HexaMap {
  const { version: _version, kind: _kind, ...fields } = diagram
  return {
    ...map,
    hexagons: map.hexagons.map((h): Hexagon => (h.id === hexId ? { id: h.id, contextId: h.contextId, cell: h.cell, ...fields } : h)),
  }
}

/**
 * Removes links whose end in `hexId` no longer stands after an edit there — its port was deleted or moved to the
 * other side (LINK-01.1/.2) — leaving every other link untouched. An end whose only problem is its own adapter
 * (deleted or re-pointed elsewhere) keeps the link, with that adapter cleared (LINK-01.3): `linkEndProblem` is
 * reused to tell the two apart, by checking whether dropping the adapter alone would already clear the problem.
 */
export function pruneLinks(map: HexaMap, hexId: string): { map: HexaMap; pruned: Link[] } {
  const pruned: Link[] = []
  let changed = false
  const links = map.links.reduce<Link[]>((kept, link) => {
    let next = link
    for (const role of ['from', 'to'] as const) {
      const end = next[role]
      if (end.hexagonId !== hexId || !linkEndProblem(map, end, role)) continue
      const withoutAdapter: LinkEnd = { ...end, adapterId: undefined }
      if (!linkEndProblem(map, withoutAdapter, role)) {
        next = { ...next, [role]: withoutAdapter }
      } else {
        pruned.push(link)
        changed = true
        return kept
      }
    }
    if (next !== link) changed = true
    kept.push(next)
    return kept
  }, [])
  return { map: changed ? { ...map, links } : map, pruned }
}

export interface PortRef {
  hexagonId: string
  hexagonTitle: string
  portId: string
  portName: string
}

/** Every port of `side` across the map, paired with its hexagon's display title (same UNTITLED_HEXAGON fallback
 * as everywhere else). Shared by the canvas "Link to…" chip (excludeHexagonId = current hexagon, opposite role
 * to the selected port) and the Links editor section's create form (no exclusion, both roles) — ADR-02. */
export function crossHexagonPorts(map: HexaMap, side: Side, excludeHexagonId?: string): PortRef[] {
  return map.hexagons
    .filter((h) => h.id !== excludeHexagonId)
    .flatMap((h) => h.ports.filter((p) => p.side === side).map((p): PortRef => ({ hexagonId: h.id, hexagonTitle: h.title || UNTITLED_HEXAGON, portId: p.id, portName: p.name })))
}

/** A link end as `{hexagonTitle} · {portName}` (falling back to UNTITLED_HEXAGON and the raw port id), shared by
 * the canvas/toolbar toasts (App) and the Links editor section's rows (Editor) — one label for both, entry-point-
 * independent like crossHexagonPorts above it (ADR-02). */
export function linkEndLabel(map: HexaMap, end: LinkEnd): string {
  const hexagon = map.hexagons.find((h) => h.id === end.hexagonId)
  const port = hexagon?.ports.find((p) => p.id === end.portId)
  return `${hexagon?.title || UNTITLED_HEXAGON} · ${port?.name ?? end.portId}`
}

/** Builds the candidate map with the new link appended (id via nextId(…, 'link')) and returns it UNvalidated — the
 * store gates on MapSchema.safeParse (ADR-02's validate-by-reparse choice: reuses checkMap's own rules instead of
 * hand-duplicating driven/driving, duplicate-pair, and pattern-eligibility checks). */
export function addLink(map: HexaMap, from: LinkEnd, to: LinkEnd): { map: HexaMap; linkId: string } {
  const linkId = nextId(map.links.map((l) => l.id), 'link')
  const link: Link = { id: linkId, from, to }
  return { map: { ...map, links: [...map.links, link] }, linkId }
}

export interface LinkPatch {
  from?: { adapterId?: string | null }
  to?: { adapterId?: string | null }
  pattern?: Link['pattern'] | null
}

/** `null` clears a field (adapter or pattern) by removing its key entirely; `undefined`/absent — the whole
 * `from`/`to`/`pattern` key missing, or `adapterId` missing from a given `from`/`to` — leaves the link's own key
 * exactly as it was, present or absent. (pruneLinks clears `adapterId` by assigning `undefined` instead, for its
 * own LINK-01.3 reasons — that is a different call site and is left as-is.) */
function applyEndPatch(end: LinkEnd, patch?: { adapterId?: string | null }): LinkEnd {
  if (!patch || patch.adapterId === undefined) return end
  if (patch.adapterId === null) {
    const { adapterId: _adapterId, ...rest } = end
    return rest
  }
  return { ...end, adapterId: patch.adapterId }
}

/** Patches one link's adapters and/or pattern in place — its id and both ends' hexagonId/portId never change
 * (REQ-LNK-03.1: reconnecting is delete + recreate, never a direct move). Never writes a `pattern` key the patch
 * didn't address (an adapter-only edit leaves the link's own pattern key exactly as it was). Candidate map is
 * UNvalidated; see addLink. */
export function updateLink(map: HexaMap, id: string, patch: LinkPatch): HexaMap {
  return {
    ...map,
    links: map.links.map((l) => {
      if (l.id !== id) return l
      const from = applyEndPatch(l.from, patch.from)
      const to = applyEndPatch(l.to, patch.to)
      if (patch.pattern === undefined) return { ...l, from, to }
      if (patch.pattern === null) {
        const { pattern: _pattern, ...rest } = l
        return { ...rest, from, to }
      }
      return { ...l, from, to, pattern: patch.pattern }
    }),
  }
}

/** Removes `id`'s link and returns it, or undefined when no link has that id — never touches another link, since
 * links are never referenced by another link. */
export function removeLink(map: HexaMap, id: string): { map: HexaMap; removed: Link } | undefined {
  const removed = map.links.find((l) => l.id === id)
  if (!removed) return undefined
  return { map: { ...map, links: map.links.filter((l) => l.id !== id) }, removed }
}
