import type { HexaMap, Link } from '../model/schema'
import { hexagonBounds } from './lattice'
import { chipBox } from './contextChips'
import { MAP_GAP } from './gap'
import { unionBox, type Box, type Point } from './geometry'
import type { LayoutModel, LayoutNode, NodeKind } from './layout'
import { GAP_MARGIN, outwardEdgePoint, routeLink } from './links'
import type { MapContextLayout, MapHexagonLayout, MapLinkLayout } from './map'

/** The node kinds REQ-LNK-05.1 names: a routed link must cross none of them, other than the node each end
 * anchors on. Excludes decorative/label nodes (`portLabel`, titles) — not "node boxes" in the requirement's
 * wording. */
const AVOIDED_KINDS: ReadonlySet<NodeKind> = new Set(['port', 'adapter', 'actor', 'external', 'useCase', 'domainItem'])

/** Spacing between adjacent lanes when several links share the same hexagon-pair gap (REQ-LNK-05.5). */
const LANE_PITCH = 10
/** The farthest a lane may push the gap midline off-centre: half of `MAP_GAP` minus `links.ts`'s `GAP_MARGIN`
 * (imported — this direction is fine, only the reverse isn't: `layLinks` calls `routeLink`, so `links.ts` must
 * never import back from this module). At this bound, a lane's crossing still sits at least `GAP_MARGIN` from the
 * NEARER of the two boxes; it never crosses that margin no matter how many links share the gap — beyond 4 links,
 * extra lanes clamp to this same outermost offset instead (they compress together rather than push into either
 * box). */
const MAX_LANE_OFFSET = MAP_GAP / 2 - GAP_MARGIN
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

/** Every link routed between its two ends, past the hexagons and chips it must avoid; `bounds` grows to hold any detour. */
export function layLinks(map: HexaMap, hexagons: MapHexagonLayout[], boxes: Box[], contexts: MapContextLayout[], bounds: Box): { links: MapLinkLayout[]; bounds: Box } {
  const hexagonOf = new Map(hexagons.map((h) => [h.id, h]))
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
  return { links, bounds }
}
