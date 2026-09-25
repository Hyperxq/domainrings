import { contextName, diagramOf, UNTITLED_HEXAGON } from '../model/map'
import type { HexaMap, Link } from '../model/schema'
import { contextRegions } from './hull'
import { layoutDiagram, type Box, type LayoutModel, type LayoutOptions, type LayoutText, type Point } from './layout'
import { arcLengthMidpoint, routeLink } from './links'
import { CHIP_LABEL, measure } from './text'

export interface MapHexagonLayout {
  id: string
  contextId: string
  cell: { q: number; r: number }
  /** Offset applied to every point of `model` to place it on the map; `model` itself stays untranslated. */
  centre: Point
  model: LayoutModel
}

export interface MapLinkLayout {
  id: string
  /** A routed polyline (ADR-01), not a straight segment — endpoints are still `points[0]` / `points.at(-1)`. */
  points: Point[]
  /** The link's DDD relationship tag, present only when its two hexagons are in different contexts (REQ-LNK-06.2). */
  pattern?: Link['pattern']
  /** The pattern label's anchor — `arcLengthMidpoint(points)` — present iff `pattern` is. */
  labelAt?: Point
}

export interface MapContextLayout {
  id: string
  label: string
  /** The context's outlined region (ADR-04): one array entry per closed loop — several for a split context or one
   * ringing a foreign hexagon (a hole). */
  loops: Point[][]
  /** Anchor for the context's name chip: above the region's topmost vertex. */
  chip: Point
}

export interface MapLayout {
  hexagons: MapHexagonLayout[]
  links: MapLinkLayout[]
  bounds: Box
  /** Only present when the map holds more than one hexagon, so a single-hexagon map's bounds equal `layoutDiagram`'s. */
  title?: LayoutText
  /** The lattice spacing this layout used (ADR-01) — lets a caller place a not-yet-existing neighbour cell, such
   * as the grow-menu anchor on a free side (SEAM-04). */
  pitch: Point
  /** One entry per context, only from two contexts up (CB-01.1) — an empty array below that threshold. */
  contexts: MapContextLayout[]
}

/** Gap kept between two adjacent hexagons' outer edges, on top of their content width. */
export const MAP_GAP = 60
const MAP_TITLE_SIZE = 20
const MAP_TITLE_GAP = 16
/** Vertical clearance between a region's topmost vertex and its chip. */
const CHIP_GAP = 12
const CHIP_HEIGHT = 16

/** Above the region's topmost vertex (min y, then min x to break ties) — always inside the map's own bounds. */
function chipAnchor(loops: Point[][]): Point {
  const top = loops.flat().reduce((best, v) => (v.y < best.y || (v.y === best.y && v.x < best.x) ? v : best))
  return { x: top.x, y: top.y - CHIP_GAP }
}

/** A chip's approximate footprint, so a long context name still grows the map's bounds to include it. */
function chipBox(chip: Point, label: string): Box {
  const width = measure(label, CHIP_LABEL)
  return { x: chip.x - width / 2, y: chip.y - CHIP_HEIGHT / 2, width, height: CHIP_HEIGHT }
}

function unionBox(boxes: Box[]): Box {
  const x0 = Math.min(...boxes.map((b) => b.x))
  const y0 = Math.min(...boxes.map((b) => b.y))
  const x1 = Math.max(...boxes.map((b) => b.x + b.width))
  const y1 = Math.max(...boxes.map((b) => b.y + b.height))
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/** A hexagon's own (untranslated) bounds, shifted onto the map by its `centre` (ADR-04). */
export const hexagonBounds = (hex: Pick<MapHexagonLayout, 'model' | 'centre'>): Box => ({
  x: hex.model.bounds.x + hex.centre.x,
  y: hex.model.bounds.y + hex.centre.y,
  width: hex.model.bounds.width,
  height: hex.model.bounds.height,
})

/** A hexagon's laid-out title, falling back like every other untitled-hexagon display. */
export const hexagonTitle = (model: LayoutModel): string => model.texts.find((t) => t.key === 'title')?.text || UNTITLED_HEXAGON

/** Resolves the map's current hexagon by id, defensively falling back to the first one so no caller can crash
 * on a stale or unknown id. */
export const currentHexagon = (layout: MapLayout, hexId: string): MapHexagonLayout =>
  layout.hexagons.find((h) => h.id === hexId) ?? layout.hexagons[0]

/** A port's `kind:'port'` layout node. */
function portNode(model: LayoutModel, portId: string) {
  const node = model.nodes.find((n) => n.kind === 'port' && n.ref === portId)
  if (!node) throw new Error(`Port "${portId}" has no layout node`)
  return node
}

/** A port's route end: its map-space point, its resolved wall (every hexagon-shape port node carries one —
 * `layoutDiagram` fills it via `p.wall ?? defaultWall(p.side)`), and its own hexagon's bounding box. */
function routeEnd(hexagon: MapHexagonLayout, portId: string) {
  const node = portNode(hexagon.model, portId)
  return { point: { x: node.x + hexagon.centre.x, y: node.y + hexagon.centre.y }, wall: node.wall!, box: hexagonBounds(hexagon) }
}

/** A hexagon's position on the affine pointy-top lattice: {0,0} sits at the origin, `e` steps by `pitch.x`,
 * `se`/`sw` by half that plus `pitch.y` down (ADR-01). */
export function cellCentre(cell: { q: number; r: number }, pitch: Point): Point {
  return { x: pitch.x * (cell.q + cell.r / 2), y: pitch.y * cell.r }
}

/**
 * Composes N untouched `layoutDiagram` outputs onto one map, by translation only — `layout.ts` itself never
 * changes. Every hexagon sits at `cellCentre(cell, pitch)`; `pitch` is the map's own maximum left/right/top/bottom
 * extents over every hexagon (this mode) plus `MAP_GAP` — not each hexagon's own width — because a pitch sized
 * for the widest hexagon still overlaps when one hexagon's content reaches unusually far right (e.g. a long-named
 * external) while another's reaches unusually far left (e.g. a long-named actor): two cells one axial step apart
 * are then guaranteed at least `MAP_GAP` apart, for any N (ADR-01).
 */
export function layoutMap(map: HexaMap, options: LayoutOptions = {}): MapLayout {
  const perHexagon = map.hexagons.map((hexagon) => ({ hexagon, model: layoutDiagram(diagramOf(map, hexagon.id), options) }))

  const left = Math.max(...perHexagon.map(({ model }) => -model.bounds.x))
  const right = Math.max(...perHexagon.map(({ model }) => model.bounds.x + model.bounds.width))
  const top = Math.max(...perHexagon.map(({ model }) => -model.bounds.y))
  const bottom = Math.max(...perHexagon.map(({ model }) => model.bounds.y + model.bounds.height))
  const pitch: Point = { x: left + right + MAP_GAP, y: top + bottom + MAP_GAP }

  const hexagons: MapHexagonLayout[] = perHexagon.map(({ hexagon, model }) => ({
    id: hexagon.id,
    contextId: hexagon.contextId,
    cell: hexagon.cell,
    centre: cellCentre(hexagon.cell, pitch),
    model,
  }))
  const hexagonOf = new Map(hexagons.map((h) => [h.id, h]))
  const links: MapLinkLayout[] = map.links.map((link: Link) => {
    const fromHexagon = hexagonOf.get(link.from.hexagonId)!
    const toHexagon = hexagonOf.get(link.to.hexagonId)!
    const points = routeLink(routeEnd(fromHexagon, link.from.portId), routeEnd(toHexagon, link.to.portId))
    // Pattern eligibility mirrors checkMap's own rule (LinkSchema refine): only a link crossing contexts may
    // carry a pattern — no hull dependency, just the two hexagons' own contextId.
    const pattern = fromHexagon.contextId !== toHexagon.contextId ? link.pattern : undefined
    return { id: link.id, points, ...(pattern ? { pattern, labelAt: arcLengthMidpoint(points) } : {}) }
  })
  let bounds = unionBox(hexagons.map(hexagonBounds))
  let title: LayoutText | undefined
  if (map.hexagons.length > 1) {
    title = { key: 'map-title', text: map.title, x: bounds.x, y: bounds.y - MAP_TITLE_GAP, style: 'title' }
    bounds = { x: bounds.x, y: bounds.y - MAP_TITLE_GAP - MAP_TITLE_SIZE, width: bounds.width, height: bounds.height + MAP_TITLE_GAP + MAP_TITLE_SIZE }
  }

  // Outlined regions + chips only from two contexts up (CB-01.1) — a single-context map draws and exports exactly
  // as a single hexagon always did (CB-01.4).
  const contexts: MapContextLayout[] = []
  if (map.contexts.length >= 2) {
    const regions = contextRegions(hexagons, pitch)
    for (const context of map.contexts) {
      const loops = regions.get(context.id) ?? []
      if (!loops.length) continue // a context declared with no hexagons (schema allows it, the store never creates one) draws nothing
      const chip = chipAnchor(loops)
      contexts.push({ id: context.id, label: contextName(map, context.id), loops, chip })
    }
    const contextBoxes = contexts.flatMap((c) => [...c.loops.flat().map((p): Box => ({ x: p.x, y: p.y, width: 0, height: 0 })), chipBox(c.chip, c.label)])
    bounds = unionBox([bounds, ...contextBoxes])
  }

  return { hexagons, links, bounds, title, pitch, contexts }
}
