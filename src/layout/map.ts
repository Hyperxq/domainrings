import { diagramOf, neighbour, UNTITLED_HEXAGON } from '../model/map'
import type { HexaMap, Link, Wall } from '../model/schema'
import { canCompact, COMPACT_MAX_SHARE, COMPACT_RADIUS, COMPACT_TITLE, compactBounds, compactOf, hexagonBounds, type CompactLayout } from './compactHexagon'
import { chipBox, CHIP_FLOOR_PX, CHIP_GAP, CHIP_LINE, layContexts, REFERENCE_STAGE } from './contextChips'
import { MAP_GAP } from './gap'
import { unionBox, type Box, type Point } from './geometry'
import { layoutDiagram, type LayoutModel, type LayoutNode, type LayoutOptions, type LayoutText, type NodeKind } from './layout'
import { GAP_MARGIN, outwardEdgePoint, routeLink, type LinkLabel } from './links'
import { CHIP_LABEL, measure, TITLE } from './text'

export { MAP_GAP }
export { canCompact, hexagonBounds, type CompactLayout } from './compactHexagon'

/** The node kinds REQ-LNK-05.1 names: a routed link must cross none of them, other than the node each end
 * anchors on. Excludes decorative/label nodes (`portLabel`, titles) — not "node boxes" in the requirement's
 * wording. */
const AVOIDED_KINDS: ReadonlySet<NodeKind> = new Set(['port', 'adapter', 'actor', 'external', 'useCase', 'domainItem'])

export interface MapHexagonLayout {
  id: string
  contextId: string
  cell: { q: number; r: number }
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
  /** The lattice spacing this layout used (ADR-01) — lets a caller place a not-yet-existing neighbour cell, such
   * as the grow-menu anchor on a free side (SEAM-04). */
  pitch: Point
  /** One entry per context, only from two contexts up (CB-01.1) — an empty array below that threshold. */
  contexts: MapContextLayout[]
}

const MAP_TITLE_GAP = 16
/** Spacing between adjacent lanes when several links share the same hexagon-pair gap (REQ-LNK-05.5). */
const LANE_PITCH = 10
/** The farthest a lane may push the gap midline off-centre: half of `MAP_GAP` minus `links.ts`'s `GAP_MARGIN`
 * (imported — this direction is fine, only the reverse isn't: `layoutMap` calls `routeLink`, so `links.ts` must
 * never import back from this module). At this bound, a lane's crossing still sits at least `GAP_MARGIN` from the
 * NEARER of the two boxes; it never crosses that margin no matter how many links share the gap — beyond 4 links,
 * extra lanes clamp to this same outermost offset instead (they compress together rather than push into either
 * box). */
const MAX_LANE_OFFSET = MAP_GAP / 2 - GAP_MARGIN
/** Where the other hexagons go once the full hexagon `full` claims its box: those at or right of its centre move right,
 * the rest left, each side by the least that clears the nearest hexagon still level with the box. A side moves as one,
 * so no two hexagons on it come closer and a pair on opposite sides only moves apart — clearing one full hexagon after
 * another therefore never undoes the clearance of an earlier one. The lattice keeps its compact pitch. */
function clearFull(centres: Point[], owns: Box[], full: number): Point[] {
  const at = (i: number): Box => ({ ...owns[i], x: owns[i].x + centres[i].x, y: owns[i].y + centres[i].y })
  const box = at(full)
  const level = (i: number) => at(i).y - (box.y + box.height) < MAP_GAP && box.y - (at(i).y + at(i).height) < MAP_GAP
  const east = (i: number) => centres[i].x >= centres[full].x
  const push = (isEast: boolean) =>
    Math.max(0, ...centres.flatMap((_, i) => (i === full || !level(i) || east(i) !== isEast ? [] : [isEast ? box.x + box.width + MAP_GAP - at(i).x : at(i).x + at(i).width - (box.x - MAP_GAP)])))
  const [eastward, westward] = [push(true), push(false)]
  return centres.map((p, i) => (i === full ? p : { x: p.x + (east(i) ? eastward : -westward), y: p.y }))
}

/** Where a grow "+" toward `side` sits: the midpoint to the neighbouring cell, pushed along that line until a button
 * of half-size `margin` clears the hexagon's own bounds — one-sided content can reach past the midpoint, and a full
 * hexagon among compact ones reaches past the neighbouring cell's centre. The push ends where the button leaves the
 * bounds, so it is finite for any non-zero step. */
export function growAnchor(hex: Pick<MapHexagonLayout, 'centre' | 'cell' | 'model'>, side: Wall, pitch: Point, margin: number): Point {
  // The lattice step, not the neighbour's cell centre: a hexagon pushed off its own cell still leaves along the line to its neighbour.
  const cellOrigin = cellCentre(hex.cell, pitch)
  const to = cellCentre(neighbour(hex.cell, side), pitch)
  const d = { x: to.x - cellOrigin.x, y: to.y - cellOrigin.y }
  const box = hexagonBounds(hex)
  const leaves = (delta: number, min: number, size: number, from: number) =>
    delta > 0 ? (min + size + margin - from) / delta : delta < 0 ? (min - margin - from) / delta : Infinity
  const t = Math.max(0.5, Math.min(leaves(d.x, box.x, box.width, hex.centre.x), leaves(d.y, box.y, box.height, hex.centre.y)))
  return { x: hex.centre.x + d.x * t, y: hex.centre.y + d.y * t }
}

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

/** An adapter's `kind:'adapter'` layout node. */
function adapterNode(model: LayoutModel, adapterId: string) {
  const node = model.nodes.find((n) => n.kind === 'adapter' && n.ref === adapterId)
  if (!node) throw new Error(`Adapter "${adapterId}" has no layout node`)
  return node
}

/** `node`'s own box, in the map space its hexagon's other geometry already sits in — nodes are centre-anchored,
 * `hexagonBounds` translates the same way. */
function translatedNodeBox(node: LayoutNode, centre: Point): Box {
  return { x: node.x - node.width / 2 + centre.x, y: node.y - node.height / 2 + centre.y, width: node.width, height: node.height }
}

/** A link end's route end: its map-space anchor point — the adapter's own outer-edge point when `adapterId` is
 * set (REQ-LNK-05.3, all six walls via `outwardEdgePoint`), else the port's own point — its resolved wall (every
 * hexagon-shape port node carries one — `layoutDiagram` fills it via `p.wall ?? defaultWall(p.side)`), its own
 * hexagon's bounding box, and this hexagon's OTHER avoided-kind node boxes (`clear`) for the escape walk to step
 * around (REQ-LNK-05.1) — never the node the anchor itself sits on. */
function routeEnd(hexagon: MapHexagonLayout, portId: string, adapterId?: string) {
  if (hexagon.compact) {
    // A compact hexagon draws no adapters: the link ends at its port's marker on the silhouette, or — for a port
    // that has no walled node to place a marker from — at the east wall's midpoint.
    const { radius, ports } = hexagon.compact
    const marker = ports.find((m) => m.id === portId) ?? { wall: 'e' as const, at: { x: (radius * Math.sqrt(3)) / 2, y: 0 } }
    return { point: { x: hexagon.centre.x + marker.at.x, y: hexagon.centre.y + marker.at.y }, wall: marker.wall, box: hexagonBounds(hexagon), clear: [] }
  }
  const port = portNode(hexagon.model, portId)
  const anchorNode = adapterId ? adapterNode(hexagon.model, adapterId) : port
  const point = adapterId ? outwardEdgePoint(translatedNodeBox(anchorNode, hexagon.centre), port.wall!) : { x: port.x + hexagon.centre.x, y: port.y + hexagon.centre.y }
  const clear = hexagon.model.nodes.filter((n) => AVOIDED_KINDS.has(n.kind) && n !== anchorNode).map((n) => translatedNodeBox(n, hexagon.centre))
  return { point, wall: port.wall!, box: hexagonBounds(hexagon), clear }
}

/** The unordered hexagon-pair a link's gap belongs to (REQ-LNK-05.5) — the SAME key for `a→b` and `b→a`, so two
 * links crossing the same gap in opposite directions still land in one lane group. */
const gapKey = (link: Link): string => [link.from.hexagonId, link.to.hexagonId].sort().join('|')

/** Rank `i`'s offset among `count` links sharing one gap: evenly spaced by `LANE_PITCH`, centred on the plain
 * (unshifted) midline, clamped to `±MAX_LANE_OFFSET`. `count === 1` always yields exactly 0 — a lone link's route
 * stays byte-identical to today's (REQ-LNK-05.5). Beyond 4 links the even spacing would exceed the clamp; those
 * extra lanes compress toward the outermost safe offset instead of crossing into either hexagon's own box. */
function laneOffset(i: number, count: number): number {
  const raw = (i - (count - 1) / 2) * LANE_PITCH
  return Math.max(-MAX_LANE_OFFSET, Math.min(MAX_LANE_OFFSET, raw))
}

/** Every link's own lane offset, keyed by link id — ranked by id (lexicographic, deterministic) within its own
 * gap group; a group's membership and ranking depend only on the links sharing that gap, never on any other
 * hexagon or link on the map (REQ-LNK-05.2). */
function laneOffsets(links: Link[]): Map<string, number> {
  const byGap = new Map<string, Link[]>()
  for (const link of links) {
    const key = gapKey(link)
    byGap.set(key, [...(byGap.get(key) ?? []), link])
  }
  const offsets = new Map<string, number>()
  for (const group of byGap.values()) {
    const ranked = [...group].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    ranked.forEach((link, i) => offsets.set(link.id, laneOffset(i, ranked.length)))
  }
  return offsets
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
export function layoutMap(map: HexaMap, options: MapLayoutOptions = {}): MapLayout {
  const full = (id: string) => id === options.current || !!options.expanded?.has(id)
  const compacting = (options.current !== undefined || options.expanded !== undefined) && canCompact(map.hexagons.length) && !map.hexagons.every((h) => full(h.id))
  const perHexagon = map.hexagons.map((hexagon) => ({
    hexagon,
    model: layoutDiagram(diagramOf(map, hexagon.id), options),
    compact: compacting && !full(hexagon.id),
  }))

  // The lattice and the hexagons' union for compact hexagons drawn at `unit` scale.
  const place = (unit: number) => {
    const owns = perHexagon.map(({ model, compact }) => (compact ? compactBounds(COMPACT_RADIUS * unit) : model.bounds))
    // Every pair of hexagons that can sit in adjacent cells must clear each other by MAP_GAP on the pitch's axis. With
    // compact neighbours the lattice is sized from the compact footprint alone: each full hexagon claims its room
    // afterwards (`clearFull`) instead of inflating every cell.
    const extents = perHexagon.map(({ compact }, i) => ({ compact, left: -owns[i].x, right: owns[i].x + owns[i].width, top: -owns[i].y, bottom: owns[i].y + owns[i].height }))
    const small = extents.filter((e) => e.compact)
    const pairs = compacting ? [[small, small]] : [[extents, extents]]
    const span = (head: 'right' | 'bottom', tail: 'left' | 'top') =>
      Math.max(...pairs.map(([a, b]) => Math.max(...a.map((e) => e[head])) + Math.max(...b.map((e) => e[tail])))) + MAP_GAP
    // Each axis keeps its box-derived minimum (no overlap). Hull tiles only trace regular hexagons on a regular
    // lattice, so a map drawn with tile hulls grows the shorter axis to the regular √3/2 ratio; compact maps hug
    // footprints instead and keep the tight pitch.
    const boxX = span('right', 'left')
    // A compact hexagon's chip sits above its hull and is as large as its title; two lines are kept free so chips wider
    // than their hexagons can stagger instead of running into each other.
    const boxY = span('bottom', 'top') + (compacting ? COMPACT_TITLE.size * unit * CHIP_LINE * 2 + 2 * CHIP_GAP : 0)
    const pitch: Point = compacting ? { x: boxX, y: boxY } : { x: Math.max(boxX, (boxY * 2) / Math.sqrt(3)), y: Math.max(boxY, (boxX * Math.sqrt(3)) / 2) }
    const cells = perHexagon.map(({ hexagon }) => cellCentre(hexagon.cell, pitch))
    const centres = compacting ? perHexagon.reduce((placed, { compact }, i) => (compact ? placed : clearFull(placed, owns, i)), cells) : cells
    const bounds = unionBox(owns.map((own, i) => ({ ...own, x: own.x + centres[i].x, y: own.y + centres[i].y })))
    return { pitch, centres, bounds }
  }
  // Like the chips below, but only approaching the floor: growing the compact hexagon grows the lattice and so lowers
  // the fit scale the title is sized against, which saturates near 8-9px on screen. More passes never reach
  // CHIP_FLOOR_PX and on large maps keep inflating the silhouette, so the passes stay capped.
  let unit = 1
  if (compacting) {
    const fullHeight = Math.min(...perHexagon.filter(({ compact }) => !compact).map(({ model }) => model.bounds.height))
    const maxUnit = (fullHeight * COMPACT_MAX_SHARE) / (2 * COMPACT_RADIUS)
    for (let pass = 0; pass < 4; pass++) {
      const { bounds } = place(unit)
      const scale = Math.min(REFERENCE_STAGE.width / bounds.width, REFERENCE_STAGE.height / bounds.height)
      unit = Math.max(1, Math.min(maxUnit, CHIP_FLOOR_PX / (COMPACT_TITLE.size * scale)))
    }
  }
  const { pitch, centres } = place(unit)

  const hexagons: MapHexagonLayout[] = perHexagon.map(({ hexagon, model, compact }, i) => ({
    id: hexagon.id,
    contextId: hexagon.contextId,
    cell: hexagon.cell,
    centre: centres[i],
    model,
    ...(compact ? { compact: compactOf(hexagon, model, unit) } : {}),
  }))
  const hexagonOf = new Map(hexagons.map((h) => [h.id, h]))
  const boxes = hexagons.map(hexagonBounds)
  const { contexts, bounds: withContexts } = layContexts(map, hexagons, boxes, pitch, compacting, unionBox(boxes))
  let bounds = withContexts

  // Routed once the chips are placed, so a route can keep off them.
  const lanes = laneOffsets(map.links)
  const detours: Point[] = []
  const chips = contexts.map((c) => chipBox(c.chip, c.label, c.size))
  const links: MapLinkLayout[] = map.links.map((link: Link) => {
    const fromHexagon = hexagonOf.get(link.from.hexagonId)!
    const toHexagon = hexagonOf.get(link.to.hexagonId)!
    const scene = { hexagons: boxes.filter((_, i) => hexagons[i] !== fromHexagon && hexagons[i] !== toHexagon), chips, within: bounds }
    const { points, label, detoured } = routeLink(
      routeEnd(fromHexagon, link.from.portId, link.from.adapterId),
      routeEnd(toHexagon, link.to.portId, link.to.adapterId),
      lanes.get(link.id),
      scene,
    )
    if (detoured) detours.push(...points)
    // Pattern eligibility mirrors checkMap's own rule (LinkSchema refine): only a link crossing contexts may
    // carry a pattern — no hull dependency, just the two hexagons' own contextId.
    const pattern = fromHexagon.contextId !== toHexagon.contextId ? link.pattern : undefined
    return { id: link.id, points, ...(pattern ? { pattern, label } : {}) }
  })
  if (detours.length) bounds = unionBox([bounds, ...detours.map((p): Box => ({ x: p.x, y: p.y, width: 0, height: 0 }))])

  // Placed last so it clears the hulls and chips the bounds just grew to include, not only the hexagons. It scales
  // with the chips, keeping its ratio over them.
  let title: LayoutText | undefined
  if (map.hexagons.length > 1) {
    const size = (TITLE.size * (contexts[0]?.size ?? CHIP_LABEL.size)) / CHIP_LABEL.size
    title = { key: 'map-title', text: map.title, x: bounds.x, y: bounds.y - MAP_TITLE_GAP, style: 'title', size }
    bounds = unionBox([bounds, { x: title.x, y: title.y - size, width: measure(title.text, { ...TITLE, size }), height: size }])
  }

  return { hexagons, links, bounds, title, pitch, contexts }
}
