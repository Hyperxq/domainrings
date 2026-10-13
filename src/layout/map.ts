import { diagramOf, neighbour, UNTITLED_HEXAGON } from '../model/map'
import type { HexaMap, Link, Wall } from '../model/schema'
import { canCompact, compactOf, type CompactLayout } from './compactHexagon'
import { layContexts } from './contextChips'
import { unionBox, type Box, type Point } from './geometry'
import { layoutDiagram, type LayoutModel, type LayoutOptions, type LayoutText } from './layout'
import { cellCentre, hexagonBounds, layLattice } from './lattice'
import { layLinks } from './linkEnds'
import type { LinkLabel } from './links'
import { CHIP_LABEL, measure, TITLE } from './text'

export interface MapHexagonLayout {
  id: string
  contextId: string
  cell: { q: number; r: number }
  /** Set only for a planned hexagon. */
  planned?: boolean
  /** Offset applied to every point of `model` to place it on the map; `model` itself stays untranslated. */
  centre: Point
  /** The full layout — for a compact hexagon it only supplies the walls its links leave through. */
  model: LayoutModel
  compact?: CompactLayout
}

export interface MapLayoutOptions extends LayoutOptions {
  /** The hexagon that is always kept in full. */
  current?: string
  /** More hexagons kept in full besides `current`. Without either (or below `COMPACT_FROM` hexagons, or when they
   * cover the whole map) every hexagon is laid out in full. */
  expanded?: ReadonlySet<string>
}

export interface MapLinkLayout {
  id: string
  /** A routed polyline (ADR-01), not a straight segment — endpoints are still `points[0]` / `points.at(-1)`,
   * each either the port's own point or, when that end carries an adapter, the adapter's outer-edge point
   * (REQ-LNK-05.3). */
  points: Point[]
  /** The link's DDD relationship tag, present only when its two hexagons are in different contexts (REQ-LNK-06.2). */
  pattern?: Link['pattern']
  /** The pattern label's placement — present iff `pattern` is. */
  label?: LinkLabel
  /** Set only for a planned link. */
  planned?: boolean
}

export interface MapContextLayout {
  id: string
  label: string
  /** The context's outlined region (ADR-04): one array entry per closed loop — several for a split context or one
   * ringing a foreign hexagon (a hole). */
  loops: Point[][]
  /** Anchor (text baseline, centred) for the context's name chip, in clear space beside its region. */
  chip: Point
  /** The chip's font size: `CHIP_LABEL.size`, or larger so it still reads at the whole-map fit scale. */
  size: number
}

export interface MapLayout {
  hexagons: MapHexagonLayout[]
  links: MapLinkLayout[]
  bounds: Box
  /** Only present when the map holds more than one hexagon, so a single-hexagon map's bounds equal `layoutDiagram`'s. */
  title?: LayoutText
  /** The lattice step (ADR-01) — gives the direction toward a not-yet-existing neighbour cell, such as the grow-menu
   * anchor on a free side (SEAM-04). Hexagons are not placed at multiples of it unless the map is compact. */
  pitch: Point
  /** One entry per context, only from two contexts up (CB-01.1) — an empty array below that threshold. */
  contexts: MapContextLayout[]
  /** The region of the lone context of a map with 2+ hexagons: drawn on the canvas only, with no name chip. */
  outline?: Point[][]
}

const MAP_TITLE_GAP = 16
/** Float slack so a button resting exactly on a box's edge counts as outside it. */
const EDGE = 1e-6
/** Where a grow "+" toward `side` sits: on the lattice line to the neighbouring cell, as near as a button of half-size
 * `margin` can get to the hexagon — just outside its bounds — and pushed further along that line past any hexagon's
 * bounds it would land on, so it never covers one. The push ends where the button leaves a box, so it is finite for any
 * non-zero step. */
export function growAnchor(hex: Pick<MapHexagonLayout, 'centre' | 'cell' | 'model'>, side: Wall, pitch: Point, margin: number, boxes: readonly Box[]): Point {
  // The lattice step, not the neighbour's cell centre: a hexagon pushed off its own cell still leaves along the line to its neighbour.
  const cellOrigin = cellCentre(hex.cell, pitch)
  const to = cellCentre(neighbour(hex.cell, side), pitch)
  const d = { x: to.x - cellOrigin.x, y: to.y - cellOrigin.y }
  const leaves = (box: Box) => {
    const along = (delta: number, min: number, size: number, from: number) => (delta > 0 ? (min + size + margin - from) / delta : delta < 0 ? (min - margin - from) / delta : Infinity)
    return Math.min(along(d.x, box.x, box.width, hex.centre.x), along(d.y, box.y, box.height, hex.centre.y))
  }
  const inside = (box: Box, t: number) => {
    const [x, y] = [hex.centre.x + d.x * t, hex.centre.y + d.y * t]
    return x > box.x - margin + EDGE && x < box.x + box.width + margin - EDGE && y > box.y - margin + EDGE && y < box.y + box.height + margin - EDGE
  }
  let t = leaves(hexagonBounds(hex))
  for (let pushed = true; pushed; ) {
    const blocking = boxes.filter((box) => inside(box, t))
    pushed = blocking.length > 0
    if (pushed) t = Math.max(...blocking.map(leaves))
  }
  return { x: hex.centre.x + d.x * t, y: hex.centre.y + d.y * t }
}

/** A hexagon's laid-out title, falling back like every other untitled-hexagon display. */
export const hexagonTitle = (model: LayoutModel): string => model.texts.find((t) => t.key === 'title')?.text || UNTITLED_HEXAGON

/** Resolves the map's current hexagon by id, defensively falling back to the first one so no caller can crash
 * on a stale or unknown id. */
export const currentHexagon = (layout: MapLayout, hexId: string): MapHexagonLayout =>
  layout.hexagons.find((h) => h.id === hexId) ?? layout.hexagons[0]

/**
 * Composes N untouched `layoutDiagram` outputs onto one map, by translation only — `layout.ts` itself never
 * changes. The cells give the topology (which hexagon is east, south-east, … of which); where a hexagon sits depends
 * on the mode. With compact neighbours each sits at `cellCentre(cell, pitch)`, a pitch sized from the compact footprint
 * and widened by `clearFull` around each full hexagon. With every hexagon in full, `packRows` places them by their
 * own extents so lattice neighbours sit about `MAP_GAP` apart, never closer (ADR-01).
 */
export function layoutMap(map: HexaMap, options: MapLayoutOptions = {}): MapLayout {
  const full = (id: string) => id === options.current || !!options.expanded?.has(id)
  const compacting = (options.current !== undefined || options.expanded !== undefined) && canCompact(map.hexagons.length) && !map.hexagons.every((h) => full(h.id))
  const perHexagon = map.hexagons.map((hexagon) => ({
    hexagon,
    model: layoutDiagram(diagramOf(map, hexagon.id), options),
    compact: compacting && !full(hexagon.id),
  }))

  const { pitch, centres, unit } = layLattice(perHexagon, compacting)

  const hexagons: MapHexagonLayout[] = perHexagon.map(({ hexagon, model, compact }, i) => ({
    id: hexagon.id,
    contextId: hexagon.contextId,
    cell: hexagon.cell,
    ...(hexagon.status ? { planned: true } : {}),
    centre: centres[i],
    model,
    ...(compact ? { compact: compactOf(hexagon, model, unit) } : {}),
  }))
  const boxes = hexagons.map(hexagonBounds)
  const { contexts, outline, bounds: withContexts } = layContexts(map, hexagons, boxes, compacting, unionBox(boxes))

  // Routed once the chips are placed, so a route can keep off them.
  const { links, bounds: routed } = layLinks(map, hexagons, boxes, contexts, withContexts)
  let bounds = routed

  // Placed last so it clears the hulls and chips the bounds just grew to include, not only the hexagons. It scales
  // with the chips, keeping its ratio over them.
  let title: LayoutText | undefined
  if (map.hexagons.length > 1) {
    const size = (TITLE.size * (contexts[0]?.size ?? CHIP_LABEL.size)) / CHIP_LABEL.size
    title = { key: 'map-title', text: map.title, x: bounds.x, y: bounds.y - MAP_TITLE_GAP, style: 'title', size }
    bounds = unionBox([bounds, { x: title.x, y: title.y - size, width: measure(title.text, { ...TITLE, size }), height: size }])
  }

  return { hexagons, links, bounds, title, pitch, contexts, ...(outline && { outline }) }
}
