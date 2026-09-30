import { wallFrame } from './layout'
import type { Box, Point } from './layout'
import type { Wall } from '../model/schema'
import { crossesBox, routeAround, type Scene } from './obstacleRoute'

/** One end's routing inputs: the anchor's world-space point (the port's own point, or an adapter's outer-edge
 * point when the end carries one — REQ-LNK-05.3), its resolved wall, its own hexagon's map-space bounding box,
 * and the OTHER node boxes in its own hexagon the escape walk must step around (REQ-LNK-05.1) — never the anchor
 * node's own box. */
export interface RouteEnd {
  point: Point
  wall: Wall
  box: Box
  clear: Box[]
}

/** The axis a wall's outward normal is dominant on (ties favour x — no wall of this hexagon shape actually ties:
 * `e`/`w` are pure-x, the four slanted walls are y-dominant since `COS30 > 0.5`), and the signed direction along
 * it the normal points. */
function escapeAxis(wall: Wall): { axis: 'x' | 'y'; dir: 1 | -1 } {
  const { n } = wallFrame(wall)
  const axis: 'x' | 'y' = Math.abs(n.x) >= Math.abs(n.y) ? 'x' : 'y'
  const dir = (axis === 'x' ? Math.sign(n.x) : Math.sign(n.y)) as 1 | -1
  return { axis, dir }
}

/**
 * `box`'s own outer edge on `wall`'s dominant axis, at `box`'s own centre on the other axis (REQ-LNK-05.3,
 * REQ-LNK-05.4) — an adapter's own outer-edge anchor. For a straight wall this is the same point the old
 * straight-wall-only anchor used to compute by a half-width nudge; for a slanted wall this is a NEW axis-aligned
 * point, replacing the old diagonal wall-normal projection.
 */
export function outwardEdgePoint(box: Box, wall: Wall): Point {
  const { axis, dir } = escapeAxis(wall)
  const onAxis = edge(box, axis, dir > 0 ? 'hi' : 'lo')
  const centreOther = axis === 'x' ? box.y + box.height / 2 : box.x + box.width / 2
  return axis === 'x' ? { x: onAxis, y: centreOther } : { x: centreOther, y: onAxis }
}

/** A quarter of `layout/map.ts`'s `MAP_GAP` (60). Exported for `map.ts`'s `MAX_LANE_OFFSET` — the import only
 * ever runs one way: `layoutMap` calls `routeLink`, so this module must never import back from `layout/map.ts`.
 * Small enough that a stub or a detour corner never travels more than `MAP_GAP/2` past its own box's edge — since
 * two hexagon boxes are always at least `MAP_GAP` apart (`layoutMap`'s own placement guarantee), a stub built from
 * this margin can never reach into the OTHER hexagon's box. */
export const GAP_MARGIN = 15

/** `box`'s own edge on `axis` (`'x' | 'y'`) facing `side` (`'lo'` = its min edge, `'hi'` = its max edge). */
function edge(box: Box, axis: 'x' | 'y', side: 'lo' | 'hi'): number {
  return axis === 'x' ? (side === 'lo' ? box.x : box.x + box.width) : side === 'lo' ? box.y : box.y + box.height
}

function otherAxis(axis: 'x' | 'y'): 'x' | 'y' {
  return axis === 'x' ? 'y' : 'x'
}

/** `value`'s escape past whichever of `lo`/`hi` it sits nearer to — `GAP_MARGIN` beyond that edge, away from the
 * box the two bound. Shared by the obstacle jog and the corner detour: both need to clear a box on the axis
 * `value` doesn't already sweep past. */
function pastNearerEdge(value: number, lo: number, hi: number): number {
  return value - lo <= hi - value ? lo - GAP_MARGIN : hi + GAP_MARGIN
}

/** How far, from `p0`, a ray with velocity `d` travels before leaving `[lo, hi]` — `Infinity` when `d` never
 * carries it out (parallel to that axis). */
function axisExit(p0: number, d: number, lo: number, hi: number): number {
  if (d === 0) return Infinity
  return d > 0 ? (hi - p0) / d : (lo - p0) / d
}

/**
 * The midline of the gap between two boxes that never overlap (`layout/map.ts` guarantees at least `MAP_GAP`
 * separation between every pair of hexagon boxes it places). Two disjoint axis-aligned boxes are always
 * separated on at least one axis (else they would overlap on both and coincide); that midline sits strictly
 * outside BOTH boxes' range on that axis, regardless of the other — a line drawn along it, at any two points on
 * the other axis, never enters either box. When both axes have a gap, X is preferred (a tie only when one box
 * sits diagonally from the other; either choice routes correctly).
 */
function gapMidline(boxA: Box, boxB: Box): { axis: 'x' | 'y'; at: number } {
  const gapX = edge(boxA, 'x', 'hi') <= edge(boxB, 'x', 'lo') || edge(boxB, 'x', 'hi') <= edge(boxA, 'x', 'lo')
  const axis: 'x' | 'y' = gapX ? 'x' : 'y'
  const [lo, hi] = edge(boxA, axis, 'hi') <= edge(boxB, axis, 'lo') ? [boxA, boxB] : [boxB, boxA]
  return { axis, at: (edge(lo, axis, 'hi') + edge(hi, axis, 'lo')) / 2 }
}

/** `p` projected onto the gap's midline — same coordinate on the OTHER axis, `mid.at` on the gap's own axis. */
function onMidline(p: Point, mid: { axis: 'x' | 'y'; at: number }): Point {
  return mid.axis === 'x' ? { x: mid.at, y: p.y } : { x: p.x, y: mid.at }
}

/** Whether sweeping `mid.axis` from `from` to `to`, at the fixed `other` coordinate on the OTHER axis, would
 * cross `box` — true only when `other` sits strictly inside the box's range on the other axis AND the swept
 * range overlaps the box's range on `mid.axis`. Every segment this module builds is axis-aligned (only one of a
 * point's two coordinates ever changes along it), so this replaces a general segment/box clip. */
function sweepCrossesBox(mid: { axis: 'x' | 'y'; at: number }, other: number, from: number, to: number, box: Box): boolean {
  const oAxis = otherAxis(mid.axis)
  if (!(other > edge(box, oAxis, 'lo') && other < edge(box, oAxis, 'hi'))) return false
  const lo = Math.min(from, to)
  const hi = Math.max(from, to)
  return hi > edge(box, mid.axis, 'lo') && lo < edge(box, mid.axis, 'hi')
}

/**
 * One end's exit points, from its anchor up to (but not including) the gap-midline crossing: an axis-aligned
 * walk along the anchor's wall's own escape axis (REQ-LNK-05.4), stepping around any of this hexagon's OTHER
 * node boxes (`end.clear`) that walk would otherwise cross (REQ-LNK-05.1), then — same as before — a corner
 * detour when the wall faces away from the gap and a straight sweep to the midline would cut back across the
 * end's own hexagon.
 *
 * The walk moves purely along `end.wall`'s escape axis, from `end.point` until `GAP_MARGIN` past where that axis
 * leaves `end.box` — clearing the hexagon's own bounding box regardless of which wall the anchor is on (a slanted
 * wall's anchor can sit well inside the box's RECTANGLE, since the box is the layout's full bounds and the
 * hexagon's actual silhouette cuts the rectangle's corners). Along the way, each `clear` box the walk would
 * otherwise cross — its OTHER-axis range still holds the walk's current other-axis coordinate, and its escape-axis
 * range lies ahead — is handled in the order the walk reaches it: advance to that box's OWN near edge first (a
 * real forward leg, never yet inside the box, since the box's escape-axis range hasn't been entered), THEN jog
 * `GAP_MARGIN` past whichever of ITS two other-axis edges is nearer (clearing it for the rest of the walk, since
 * every remaining leg holds the other axis fixed at the jogged value) — advancing all the way to the box's own
 * escape-axis position BEFORE jogging is what keeps the jog leg itself from ever entering the box (a jog taken
 * while still short of the box's near edge would sweep the OTHER axis at an escape-axis position already outside
 * the box; the reverse order — jogging first, in place — would cut straight through the box on the way there).
 * Bounded by `end.clear.length` (this hexagon's own node count only, REQ-LNK-05.2-safe: no other hexagon's nodes
 * are ever in `end.clear`).
 *
 * Once clear of `end.box`, the same corner-detour check as before (`sweepCrossesBox` against `end.box` only)
 * decides whether one more point is needed before crossing to the gap midline: when the wall faces roughly
 * toward the gap, sweeping straight onto the midline (keeping the other axis fixed at the walk's own final value)
 * never re-enters the box; when it faces AWAY, that same sweep would traverse the box, so a corner escapes on
 * the other axis first, exactly as the obstacle jogs did.
 */
function exitPoints(end: RouteEnd, mid: { axis: 'x' | 'y'; at: number }): Point[] {
  const points = exitWalk(end)
  const stub = points[points.length - 1]
  const midOther = mid.axis === 'x' ? stub.y : stub.x
  const stubGap = mid.axis === 'x' ? stub.x : stub.y
  if (!sweepCrossesBox(mid, midOther, stubGap, mid.at, end.box)) return points

  const midOAxis = otherAxis(mid.axis)
  const loEdge = edge(end.box, midOAxis, 'lo')
  const hiEdge = edge(end.box, midOAxis, 'hi')
  const cornerOther = pastNearerEdge(midOther, loEdge, hiEdge)
  const corner: Point = mid.axis === 'x' ? { x: stub.x, y: cornerOther } : { x: cornerOther, y: stub.y }
  return [...points, corner]
}

/** `exitPoints` up to its stub: the escape walk alone, ending `GAP_MARGIN` outside `end.box` — before any corner detour
 * toward a particular gap. `exit` defaults to the wall's own escape axis. */
function exitWalk(end: RouteEnd, exit = escapeAxis(end.wall)): Point[] {
  const { axis, dir } = exit
  const oAxis = otherAxis(axis)
  const boxExit = axisExit(end.point[axis], dir, edge(end.box, axis, 'lo'), edge(end.box, axis, 'hi'))
  const target = end.point[axis] + dir * (boxExit + GAP_MARGIN)

  const points: Point[] = []
  let pos = end.point[axis]
  let other = end.point[oAxis]
  const remaining = [...end.clear]
  const nearEdge = (box: Box) => edge(box, axis, dir > 0 ? 'lo' : 'hi')
  const farEdge = (box: Box) => edge(box, axis, dir > 0 ? 'hi' : 'lo')
  const ahead = (box: Box) => (dir > 0 ? farEdge(box) > pos && nearEdge(box) < target : farEdge(box) < pos && nearEdge(box) > target)
  const nextBlocking = () => remaining.find((box) => other > edge(box, oAxis, 'lo') && other < edge(box, oAxis, 'hi') && ahead(box))

  for (let blocking = nextBlocking(); blocking; blocking = nextBlocking()) {
    // Stop GAP_MARGIN short of the box's own near edge, never its exact boundary — sitting exactly ON it would
    // leave the jog leg touching the box, and a zero-width (axis-aligned) segment touching an edge still counts
    // as entering it once its OTHER coordinate sweeps through the box's own range on that axis. Never regresses
    // behind the walk's current position (a box whose near edge is already behind `pos` still gets its jog here).
    const approach = nearEdge(blocking) - dir * GAP_MARGIN
    pos = dir > 0 ? Math.max(pos, approach) : Math.min(pos, approach)
    points.push(axis === 'x' ? { x: pos, y: other } : { x: other, y: pos })
    const loEdge = edge(blocking, oAxis, 'lo')
    const hiEdge = edge(blocking, oAxis, 'hi')
    other = pastNearerEdge(other, loEdge, hiEdge)
    points.push(axis === 'x' ? { x: pos, y: other } : { x: other, y: pos })
    remaining.splice(remaining.indexOf(blocking), 1)
  }
  points.push(axis === 'x' ? { x: target, y: other } : { x: other, y: target })
  return points
}

/** The way `end` leaves its own box along its wall's other axis, for a slanted wall that faces two axes at once —
 * what a port uses when a chip or box sits right in front of its own escape axis. */
function sideWalk(end: RouteEnd): Point[] | undefined {
  const { axis } = escapeAxis(end.wall)
  const { n } = wallFrame(end.wall)
  const side = axis === 'x' ? n.y : n.x
  return side === 0 ? undefined : exitWalk(end, { axis: otherAxis(axis), dir: Math.sign(side) as 1 | -1 })
}

/** Drops a point that repeats the one before it — the two exit-point lists can independently land on the same
 * gap-midline crossing (e.g. a symmetric detour on both ends), which would otherwise leave a zero-length segment. */
function dedupe(points: Point[]): Point[] {
  return points.filter((p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y)
}

/** Where a routed link's pattern label sits: halfway along its midline crossing — the one stretch guaranteed
 * outside both endpoint boxes — and `vertical` when that midline runs vertically, so the label is turned to run
 * along it and its width stays inside the gap instead of spilling onto either hexagon (REQ-LNK-06.1). */
export interface LinkLabel {
  at: Point
  vertical: boolean
}

/**
 * Deterministic channel route between two ports (ADR-01, refined) — a pure function of the two endpoints (plus
 * the caller-supplied `laneOffset`, itself derived only from links sharing this same gap — `layout/map.ts`'s own
 * concern, never inspected here); without a `scene` it never inspects any hexagon but the two endpoints, so it is
 * O(1) per link regardless of map size (REQ-LNK-05.2). Crosses via the midline of the gap the two hexagons' own boxes are
 * guaranteed to have between them (`layout/map.ts` never places two boxes closer than `MAP_GAP`), reached from
 * each port via `exitPoints` — a bounded exit stub, plus a corner detour when the port's own wall faces away from
 * the gap — so the guarantee holds regardless of which wall either port sits on (REQ-LNK-05.1).
 *
 * `laneOffset` (default 0, reproducing today's single-link route exactly) shifts the midline's own `at` coordinate
 * before either end's crossing is computed — moving the whole crossing segment sideways, parallel to itself, so
 * two links sharing a gap land on distinct, non-overlapping parallel crossings instead of the same one
 * (REQ-LNK-05.5). The label — always the midpoint of the two (now shifted) crossings — follows automatically,
 * without separate bookkeeping (REQ-LNK-06.1 holds under lanes).
 *
 * With a `scene`, a route that would pass through a hexagon other than its two ends, or across a chip, is replaced by
 * one `routeAround` finds between the two exit stubs, labelled on its longest run and flagged `detoured` — it may run
 * outside `scene.within`, so the caller widens its bounds; when no such route exists the direct one stands.
 */
export function routeLink(from: RouteEnd, to: RouteEnd, laneOffset = 0, scene?: Scene): { points: Point[]; label: LinkLabel; detoured?: true } {
  const gap = gapMidline(from.box, to.box)
  const mid = { axis: gap.axis, at: gap.at + laneOffset }
  const fromExit = exitPoints(from, mid)
  const toExit = exitPoints(to, mid)
  const fromCross = onMidline(fromExit[fromExit.length - 1], mid)
  const toCross = onMidline(toExit[toExit.length - 1], mid)

  const direct = {
    points: dedupe([from.point, ...fromExit, fromCross, toCross, ...[...toExit].reverse(), to.point]),
    label: { at: { x: (fromCross.x + toCross.x) / 2, y: (fromCross.y + toCross.y) / 2 }, vertical: mid.axis === 'x' },
  }
  if (!scene || !crossesBox(direct.points, [...scene.hexagons, ...scene.chips])) return direct

  const stub = (walk: Point[]) => walk[walk.length - 1]
  const around = { ...scene, hexagons: [...scene.hexagons, from.box, to.box] }
  // A walk runs from the anchor, inside its own box, so it only has to keep off what the search also keeps off.
  const open = (end: RouteEnd, other: RouteEnd, walk?: Point[]) => (walk && !crossesBox([end.point, ...walk], [...scene.hexagons, ...scene.chips, other.box]) ? [walk] : [])
  const [fromPrimary, fromSide] = [open(from, to, exitWalk(from)), open(from, to, sideWalk(from))]
  const [toPrimary, toSide] = [open(to, from, exitWalk(to)), open(to, from, sideWalk(to))]
  const search = (fromWalks: Point[][], toWalks: Point[][]) =>
    fromWalks.length && toWalks.length ? routeAround(fromWalks.map(stub), toWalks.map(stub), around, laneOffset) : undefined
  let detour = search(fromPrimary, toPrimary)
  if (!detour && (fromSide.length || toSide.length)) detour = search([...fromPrimary, ...fromSide], [...toPrimary, ...toSide])
  if (!detour || detour.length < 2) return direct
  const fromWalks = [...fromPrimary, ...fromSide]
  const toWalks = [...toPrimary, ...toSide]
  const endsAt = (p: Point) => (walk: Point[]) => stub(walk).x === p.x && stub(walk).y === p.y
  const fromWalk = fromWalks.find(endsAt(detour[0]))!
  const toWalk = toWalks.find(endsAt(detour[detour.length - 1]))!
  const [longest] = detour.slice(1).map((p, i) => ({ a: detour[i], b: p })).sort((s, t) => Math.hypot(t.b.x - t.a.x, t.b.y - t.a.y) - Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y))
  return {
    points: dedupe([from.point, ...fromWalk, ...detour, ...[...toWalk].reverse(), to.point]),
    label: { at: { x: (longest.a.x + longest.b.x) / 2, y: (longest.a.y + longest.b.y) / 2 }, vertical: longest.a.x === longest.b.x },
    detoured: true,
  }
}
