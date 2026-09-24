import { linkEndProblem, type Diagram, type HexaMap, type Hexagon, type Link, type LinkEnd, type Wall } from './schema'

/** Shown wherever a hexagon's title is displayed or exported but was left blank. */
export const UNTITLED_HEXAGON = 'Untitled hexagon'

export type Cell = Hexagon['cell']

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
export function nextId(ids: readonly string[], prefix: 'h' | 'c'): string {
  const pattern = new RegExp(`^${prefix}(\\d+)$`)
  const max = ids.reduce((max, id) => Math.max(max, Number(pattern.exec(id)?.[1] ?? 0)), 0)
  return `${prefix}${max + 1}`
}

/** A context's display name: its own name, else "Context {n}" from its id's numeric suffix, else its 1-based
 * position among the map's contexts (ADR-03) — stable while the context exists (CB-03.2). */
export function contextName(map: Pick<HexaMap, 'contexts'>, contextId: string): string {
  const index = map.contexts.findIndex((c) => c.id === contextId)
  const context = map.contexts[index]
  if (context?.name) return context.name
  const suffix = /^c(\d+)$/.exec(contextId)?.[1]
  return `Context ${suffix ?? index + 1}`
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
