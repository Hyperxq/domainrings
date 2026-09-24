import { diagramOf, UNTITLED_HEXAGON } from '../model/map'
import type { HexaMap, Link } from '../model/schema'
import { layoutDiagram, type Box, type LayoutModel, type LayoutOptions, type LayoutText, type Point } from './layout'

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
  points: [Point, Point]
}

export interface MapLayout {
  hexagons: MapHexagonLayout[]
  links: MapLinkLayout[]
  bounds: Box
  /** Only present when the map holds more than one hexagon, so a single-hexagon map's bounds equal `layoutDiagram`'s. */
  title?: LayoutText
}

/** Gap kept between two adjacent hexagons' outer edges, on top of their content width. */
export const MAP_GAP = 60
const MAP_TITLE_SIZE = 20
const MAP_TITLE_GAP = 16

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

/** The centre of a port's `kind:'port'` layout node, shifted from hexagon-local space onto the map. */
function portPoint(model: LayoutModel, portId: string, centre: Point): Point {
  const node = model.nodes.find((n) => n.kind === 'port' && n.ref === portId)
  if (!node) throw new Error(`Port "${portId}" has no layout node`)
  return { x: node.x + centre.x, y: node.y + centre.y }
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
  const centreOf = new Map(hexagons.map((h) => [h.id, h.centre]))
  const modelOf = new Map(hexagons.map((h) => [h.id, h.model]))
  const links: MapLinkLayout[] = map.links.map((link: Link) => ({
    id: link.id,
    points: [
      portPoint(modelOf.get(link.from.hexagonId)!, link.from.portId, centreOf.get(link.from.hexagonId)!),
      portPoint(modelOf.get(link.to.hexagonId)!, link.to.portId, centreOf.get(link.to.hexagonId)!),
    ],
  }))
  let bounds = unionBox(hexagons.map(hexagonBounds))
  let title: LayoutText | undefined
  if (map.hexagons.length > 1) {
    title = { key: 'map-title', text: map.title, x: bounds.x, y: bounds.y - MAP_TITLE_GAP, style: 'title' }
    bounds = { x: bounds.x, y: bounds.y - MAP_TITLE_GAP - MAP_TITLE_SIZE, width: bounds.width, height: bounds.height + MAP_TITLE_GAP + MAP_TITLE_SIZE }
  }
  return { hexagons, links, bounds, title }
}
