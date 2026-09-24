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

/**
 * Composes N untouched `layoutDiagram` outputs onto one map, by translation only — `layout.ts` itself never
 * changes. #1 places every hexagon on a single row keyed by `cell.q`; a honeycomb pitch for `cell.r !== 0` is a
 * later slice's job.
 */
export function layoutMap(map: HexaMap, options: LayoutOptions = {}): MapLayout {
  const perHexagon = map.hexagons.map((hexagon) => ({ hexagon, model: layoutDiagram(diagramOf(map, hexagon.id), options) }))

  // Places hexagons left-to-right by cell.q from their REAL extents, not a uniform width-based pitch: a pitch
  // sized for the widest hexagon still overlaps when one hexagon's content reaches unusually far right (e.g. a
  // long-named external) while its neighbour's reaches unusually far left (e.g. a long-named actor) — the two
  // extents can out-grow the pitch even though neither hexagon's own width does.
  const byQ = [...perHexagon].sort((a, b) => a.hexagon.cell.q - b.hexagon.cell.q)
  const centreXOf = new Map<string, number>()
  let previousRightEdge: number | undefined
  for (const { hexagon, model } of byQ) {
    const centreX = previousRightEdge === undefined ? 0 : previousRightEdge + MAP_GAP - model.bounds.x
    centreXOf.set(hexagon.id, centreX)
    previousRightEdge = centreX + model.bounds.x + model.bounds.width
  }

  const hexagons: MapHexagonLayout[] = perHexagon.map(({ hexagon, model }) => ({
    id: hexagon.id,
    contextId: hexagon.contextId,
    cell: hexagon.cell,
    centre: { x: centreXOf.get(hexagon.id)!, y: 0 },
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
