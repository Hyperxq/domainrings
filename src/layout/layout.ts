import { KINDS, type RingRole, type Shape } from '../model/kinds'
import { defaultWall, type Adapter, type Diagram, type DomainItem, type Endpoint, type Port, type Side, type Wall } from '../model/schema'
import { adapterTag, DOMAIN_TAGS, portTag, USE_CASE_TAG } from './tags'
import { DOMAIN_TITLE, EDGE_LABEL, LINE_METRICS, lineWidth, measure, noteLines, RING_LABEL, RING_SUBTITLE, styled, SUBTITLE, TITLE, type TextLine } from './text'

export interface Point {
  x: number
  y: number
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** Colour = side or layer: driving and driven pills, slate external systems, teal ports and use cases. */
export type Tone = 'driving' | 'driven' | 'teal' | 'slate' | 'muted' | 'domain'
export type NodeKind =
  | 'actor'
  | 'adapter'
  | 'port'
  | 'useCase'
  | 'external'
  | 'domainItem'
  | 'aggregate'
  | 'note'
  | 'portDecl'
  | 'composition'

/** Centre-anchored box holding typed text lines. */
export interface LayoutNode {
  key: string
  ref: string
  kind: NodeKind
  tone: Tone
  lines: TextLine[]
  /** 'center' draws every line on the node's x axis. */
  align?: 'center'
  /** The ring this element belongs to, for layer highlighting; none for elements outside every ring. */
  layer?: RingRole
  side?: Side
  /** Hexagons: the application-ring wall a port sits on; its adapter and actor or external share it. */
  wall?: Wall
  /** Degrees; a socket on a slanted wall lies along it. Every other box stays upright. */
  rotation?: number
  x: number
  y: number
  width: number
  height: number
}

/**
 * Circles use halfWidth as radius. Hexagons are regular and pointy-top with circumradius apex:
 * vertical sides at ±halfWidth (= apex·cos30) for |dy| <= straight (= apex/2), then 30° slopes.
 */
export interface LayoutRing {
  key: string
  role: RingRole
  /** Uppercase layer title, with an optional sentence-case subtitle line under it. */
  title: string
  subtitle?: string
  halfWidth: number
  straight: number
  apex: number
  labelAt: Point
}

export interface LayoutEdge {
  key: string
  /** import: arrow; wiring: composition root; declares: domain-declared port → socket. */
  kind: 'import' | 'wiring' | 'declares'
  points: Point[]
  label?: string
  labelAt?: Point
  /** Index of the point where the path leaves the domain fill; the parts either side are drawn in their own tone. */
  insideTo?: number
}

/** Left-anchored at (x, y). */
export interface LayoutText {
  key: string
  text: string
  x: number
  y: number
  style: 'title' | 'subtitle'
}

/** Overview drops everything but names, the rings, notched sockets and the horizontal flow. */
export type LayoutMode = 'detailed' | 'overview'

export interface LayoutOptions {
  mode?: LayoutMode
}

export interface LayoutModel {
  shape: Shape
  rings: LayoutRing[]
  /** Hexagons only: dashed spokes from each outer vertex in to the matching domain vertex. */
  guides: { from: Point; to: Point }[]
  nodes: LayoutNode[]
  edges: LayoutEdge[]
  texts: LayoutText[]
  bounds: Box
}

const SQRT3 = Math.sqrt(3)
const COS30 = SQRT3 / 2
const PAD_X = 12
const PAD_Y = 9
const GAP = 14
const PAD = 16
const ROW_GAP = 18
const MIN_BAND = 36
const DOMAIN_PAD = 24
const LABEL_LINE = RING_LABEL.size + 4
const LABEL_INSET = 8
const LABEL_PAD_X = 8
const SUBTITLE_GAP = 4
/** Spacing between parallel use-case buses, and the straight run every arrow keeps before its head. */
const LANE = 12
const RUN = 16
const COLUMN_GAP = 32
/** Past these rendered line counts the domain tree, then the declared-port list, flow into two columns. */
const DOMAIN_MAX_LINES = 8
const PORTS_MAX_LINES = 4
/** An aggregate outline: 8 padding all round, plus its tag line above the root. */
const OUTLINE_PAD = 8
const BLOCK_GAP = 6
/** Room between a use case and the ring it asks, for the arrow's straight run and its label. */
const DOMAIN_RUN = 34
const OUTSIDE_GAP = 20
const MARGIN = 16
/** Every wall-hosted box stays this far inside its wall's 60° sector, so the spokes run clear of it. */
const SECTOR_CLEAR = 8
/** The composition trunk hugs the outer hexagon this far out. */
const TRUNK_GAP = OUTSIDE_GAP / 2

// Wall frames of a pointy-top hexagon (y down): n is the outward normal, dir runs along the wall. A wall's midpoint
// sits at the apothem along n, so any wall-hosted point is (apothem + v)·n + u·dir.
const SLANTED_WALLS: ReadonlySet<Wall> = new Set(['nw', 'sw', 'ne', 'se'])
// Exact unit vectors (0, ±½, ±1, ±cos30) rather than trig, so axis-aligned runs come out exactly axis-aligned and
// both ends of a shared edge land on identical coordinates.
const WALL_NORMAL: Record<Wall, Point> = {
  e: { x: 1, y: 0 },
  se: { x: 0.5, y: COS30 },
  sw: { x: -0.5, y: COS30 },
  w: { x: -1, y: 0 },
  nw: { x: -0.5, y: -COS30 },
  ne: { x: 0.5, y: -COS30 },
}
/** Hexagon vertices on the unit circle, clockwise from the top. */
const VERTEX: Point[] = [
  { x: 0, y: -1 },
  { x: COS30, y: -0.5 },
  { x: COS30, y: 0.5 },
  { x: 0, y: 1 },
  { x: -COS30, y: 0.5 },
  { x: -COS30, y: -0.5 },
]
export function wallFrame(wall: Wall) {
  const n = WALL_NORMAL[wall]
  return { n, dir: { x: -n.y === 0 ? 0 : -n.y, y: n.x } }
}
/** The wall's line angle in degrees, folded into (−90, 90]. */
const wallAngle = (wall: Wall) => {
  const { dir } = wallFrame(wall)
  return (((Math.atan2(dir.y, dir.x) * 180) / Math.PI + 450) % 180) - 90
}
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y
/** Half the extent of an upright w×h box along a unit vector. */
const reach = (w: number, h: number, v: Point) => (w / 2) * Math.abs(v.x) + (h / 2) * Math.abs(v.y)
/** Smallest apothem keeping a local point (u along the wall, v off its line) inside the wall's sector. */
const sectorApothem = (u: number, v: number) => (Math.abs(u) + SECTOR_CLEAR / COS30) * SQRT3 - v

function rectCorners(cx: number, cy: number, w: number, h: number, rotation = 0): Point[] {
  const a = (rotation * Math.PI) / 180
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx, sy]) => {
    const [ox, oy] = [(sx * w) / 2, (sy * h) / 2]
    return { x: cx + ox * Math.cos(a) - oy * Math.sin(a), y: cy + ox * Math.sin(a) + oy * Math.cos(a) }
  })
}

/** Separating-axis test for convex quads; touching does not count. */
function quadsOverlap(a: Point[], b: Point[]) {
  const axes = [a, b].flatMap((q) => [{ x: q[1].x - q[0].x, y: q[1].y - q[0].y }, { x: q[3].x - q[0].x, y: q[3].y - q[0].y }])
  return axes.every((axis) => {
    const [pa, pb] = [a.map((p) => dot(p, axis)), b.map((p) => dot(p, axis))]
    return Math.min(...pa) < Math.max(...pb) - 1e-6 && Math.min(...pb) < Math.max(...pa) - 1e-6
  })
}

/** Where a ray from `from` along `v` first enters an upright box (slab method); `from` itself if it never does. */
function enterBox(box: { x: number; y: number; width: number; height: number }, from: Point, v: Point): Point {
  let [t0, t1] = [-Infinity, Infinity]
  for (const [o, d, lo, hi] of [
    [from.x, v.x, box.x - box.width / 2, box.x + box.width / 2],
    [from.y, v.y, box.y - box.height / 2, box.y + box.height / 2],
  ]) {
    if (Math.abs(d) < 1e-12) {
      if (o < lo || o > hi) return from
      continue
    }
    const [a, b] = [(lo - o) / d, (hi - o) / d].sort((p, q) => p - q)
    t0 = Math.max(t0, a)
    t1 = Math.min(t1, b)
  }
  return t0 <= t1 && t1 >= 0 ? { x: from.x + v.x * Math.max(0, t0), y: from.y + v.y * Math.max(0, t0) } : from
}


interface Outline {
  halfWidth: number
  straight: number
  apex: number
}

interface Need {
  x: number
  y: number
}

function halfWidthAt(shape: Shape, o: Outline, dy: number): number {
  const a = Math.abs(dy)
  if (shape === 'circle') return Math.sqrt(Math.max(0, o.halfWidth ** 2 - a * a))
  return a <= o.straight ? o.halfWidth : Math.max(0, o.halfWidth - (a - o.straight) * SQRT3)
}

/** Distance from the centre line to the ring's top edge at horizontal offset x (0 outside the ring). */
function topAt(shape: Shape, o: Outline, x: number): number {
  const a = Math.abs(x)
  if (a >= o.halfWidth) return shape === 'circle' ? 0 : o.straight
  return shape === 'circle' ? Math.sqrt(o.halfWidth ** 2 - a * a) : o.straight + (o.halfWidth - a) / SQRT3
}

/** Depth below the apex from which the ring is at least 2·half wide. */
function depthAt(shape: Shape, o: Outline, half: number): number {
  if (shape === 'circle') return o.apex - Math.sqrt(Math.max(0, o.apex ** 2 - half ** 2))
  return Math.min(half / SQRT3, o.apex - o.straight)
}

const circle = (r: number): Outline => ({ halfWidth: r, straight: 0, apex: r })
const hexagon = (r: number): Outline => ({ halfWidth: r * COS30, straight: r / 2, apex: r })

/**
 * Smallest ring around `inner` holding every need. A regular hexagon's half-width at dy is
 * min(r·cos30, (r − |dy|)·√3), so a point (x, y) needs r >= x/cos30 and r >= y + x/√3. `side` needs
 * must also land on the straight vertical side (|dy| <= r/2), where ports and adapters line up.
 */
function fitRing(shape: Shape, inner: Outline, side: Need[], vertical: Need[], minApothem = 0): Outline {
  const needs = [...side, ...vertical]
  if (shape === 'circle') {
    return circle(Math.max(inner.halfWidth + MIN_BAND, ...needs.map((n) => Math.hypot(n.x, n.y))))
  }
  return hexagon(
    Math.max(
      minApothem / COS30,
      inner.apex + MIN_BAND / COS30,
      ...needs.map((n) => Math.max(n.x / COS30, n.y + n.x / SQRT3)),
      ...side.map((n) => 2 * n.y),
    ),
  )
}

function frame(lines: TextLine[], minWidth = 0, padY = PAD_Y, padX = PAD_X) {
  return {
    lines,
    width: Math.max(minWidth, ...lines.map(lineWidth)) + 2 * padX,
    height: lines.reduce((h, l) => h + LINE_METRICS[l.style].height, 0) + 2 * padY,
  }
}
type Frame = ReturnType<typeof frame>

interface Slot {
  adapter: Adapter
  leaves: Endpoint[]
}

interface Group {
  port?: Port
  slots: Slot[]
}

interface Column {
  groups: Group[]
  loose: Endpoint[]
  rows: number
}

/** A box whose row (y) is known before the rings are solved; x comes after. */
interface Planned {
  key: string
  ref: string
  kind: NodeKind
  side: Side
  y: number
  frame: Frame
  height: number
}

const groupRows = (g: Group) =>
  g.slots.length ? g.slots.reduce((n, s) => n + Math.max(1, s.leaves.length), 0) : 1

/** A port with its adapters, each adapter with the actors or externals it serves. */
function portGroups(d: Diagram, side: Side, ports: Port[]): Group[] {
  const endpoints = side === 'driving' ? d.actors : d.externals
  const slot = (adapter: Adapter): Slot => ({ adapter, leaves: endpoints.filter((e) => e.adapterId === adapter.id) })
  return ports.map((port) => ({ port, slots: d.adapters.filter((a) => a.portId === port.id).map(slot) }))
}

/** The w/e wall columns: their ports, unassigned adapters, and every endpoint no wall has claimed. */
function buildColumn(
  d: Diagram,
  side: Side,
  ports: Port[],
  adapterSide: (a: Adapter) => Side,
  portOf: (a: Adapter) => Port | undefined,
  claimed: Set<string>,
): Column {
  const endpoints = side === 'driving' ? d.actors : d.externals
  const groups: Group[] = [
    ...portGroups(d, side, ports),
    ...d.adapters
      .filter((a) => !portOf(a) && adapterSide(a) === side)
      .map((adapter) => ({ slots: [{ adapter, leaves: endpoints.filter((e) => e.adapterId === adapter.id) }] })),
  ]
  const placed = new Set([...claimed, ...groups.flatMap((g) => g.slots.flatMap((s) => s.leaves.map((l) => l.id)))])
  return {
    groups,
    loose: endpoints.filter((e) => !placed.has(e.id)),
    rows: groups.reduce((n, g) => n + groupRows(g), 0),
  }
}

/**
 * Lane ranks (0 = innermost) for links that leave at row `from` and arrive at row `to`, chosen so no link's
 * vertical run crosses another link's horizontal runs; clashing constraints fall back to input order.
 */
function laneOrder(spans: Array<[number, number]>): number[] {
  const within = (y: number, [a, b]: [number, number]) => Math.min(a, b) < y && y < Math.max(a, b)
  // outside[i]: links that must run further out than link i.
  const outside = spans.map((si, i) =>
    new Set(spans.flatMap((sj, j) => (i !== j && within(si[0], sj) ? [j] : []))),
  )
  spans.forEach((si, i) => spans.forEach((sj, j) => i !== j && within(si[1], sj) && outside[j].add(i)))
  const order: number[] = []
  while (order.length < spans.length) {
    const free = spans.findIndex((_, i) => !order.includes(i) && spans.every((_, j) => order.includes(j) || !outside[j].has(i)))
    order.push(free >= 0 ? free : spans.findIndex((_, i) => !order.includes(i)))
  }
  return spans.map((_, i) => order.indexOf(i))
}

const dedupe = (points: Point[]) => points.filter((p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y)

const SIDES = ['driving', 'driven'] as const
const nearest = (y: number, height: number) => Math.max(0, Math.abs(y) - height / 2)
const farthest = (y: number, height: number) => Math.abs(y) + height / 2

export function layoutDiagram(d: Diagram, { mode = 'detailed' }: LayoutOptions = {}): LayoutModel {
  const overview = mode === 'overview'
  const config = KINDS[d.kind]
  const { shape, labels } = config
  const ports = new Map(d.ports.map((p) => [p.id, p]))
  const portOf = (a: Adapter) => (a.portId ? ports.get(a.portId) : undefined)
  const adapterSide = (a: Adapter): Side =>
    portOf(a)?.side ??
    (d.externals.some((e) => e.adapterId === a.id) && !d.actors.some((e) => e.adapterId === a.id) ? 'driven' : 'driving')
  // Hexagons honour each port's wall; circles keep every port in the left or right column.
  const wallOf = (p: Port): Wall => (shape === 'hexagon' ? (p.wall ?? defaultWall(p.side)) : defaultWall(p.side))
  const slantedPorts = d.ports.filter((p) => SLANTED_WALLS.has(wallOf(p)))
  const slantedAdapters = new Set(d.adapters.filter((a) => slantedPorts.some((p) => p.id === a.portId)).map((a) => a.id))
  const claimed = new Set([...d.actors, ...d.externals].filter((e) => e.adapterId && slantedAdapters.has(e.adapterId)).map((e) => e.id))
  const columnPorts = (side: Side) => d.ports.filter((p) => p.side === side && !SLANTED_WALLS.has(wallOf(p)))
  const columns: Record<Side, Column> = {
    driving: buildColumn(d, 'driving', columnPorts('driving'), adapterSide, portOf, claimed),
    driven: buildColumn(d, 'driven', columnPorts('driven'), adapterSide, portOf, claimed),
  }
  const hasSlanted = slantedPorts.length > 0

  // 1. Box contents: every size below derives from the text a box has to hold.
  // Overview pills carry the name only, unwrapped; its sockets are bare notches on the ring edge.
  const nameFrame = (name: string) => frame(styled('name', name), 80)
  const NOTCH: Frame = { lines: [], width: 14, height: 30 }
  const adapterFrame = (a: Adapter, side: Side) =>
    overview ? nameFrame(a.name) : frame([...styled('eyebrow', adapterTag(side, labels)), ...styled('name', a.name, 18), ...noteLines(a.note)], 110)
  const socketFrame = (p: Port) =>
    overview ? NOTCH : frame([...styled('tag', portTag(p.side, labels)), ...styled('name', p.name, 18), ...noteLines(p.note)], 70)
  const leafFrame = (e: Endpoint, side: Side) =>
    overview ? frame(styled('title', e.name), 80) : frame([...styled('title', e.name, 16), ...noteLines(e.note, side === 'driven' ? 'mono' : 'muted')], 80)
  // The type tag replaces the old type line. An aggregate root's tag sits on its outline, so the root line is just
  // its name, set strong; other roots carry the tag above their name.
  const domainFrame = (i: DomainItem) =>
    i.type === 'aggregate'
      ? frame([...styled('strong', i.name), ...noteLines(i.note)], 0, 2, 0)
      : frame([...styled('tag', DOMAIN_TAGS[i.type]), ...styled('mono', i.name), ...noteLines(i.note)], 0, 2, 0)

  // 2. Rows: a uniform pitch fitted to the tallest single-row box, centred on the ring centre.
  const pending = SIDES.flatMap((side) => {
    const col = columns[side]
    return [
      ...col.groups.flatMap((g) => [
        ...(g.port ? [{ side, key: `port:${g.port.id}`, frame: socketFrame(g.port) }] : []),
        ...g.slots.flatMap((s) => [
          { side, key: `adapter:${s.adapter.id}`, frame: adapterFrame(s.adapter, side) },
          ...s.leaves.map((l) => ({ side, key: `leaf:${l.id}`, frame: leafFrame(l, side) })),
        ]),
      ]),
      ...col.loose.map((l) => ({ side, key: `leaf:${l.id}`, frame: leafFrame(l, side) })),
    ]
  })
  const frameOf = new Map(pending.map((p) => [p.key, p.frame]))
  const ROW = Math.max(36, ...pending.map((p) => p.frame.height)) + ROW_GAP
  const widest = (side: Side, prefix: string) =>
    Math.max(0, ...pending.filter((p) => p.side === side && p.key.startsWith(prefix)).map((p) => p.frame.width))
  const widths = Object.fromEntries(
    SIDES.map((s) => [s, { socketHalf: widest(s, 'port:') / 2, adapter: widest(s, 'adapter:'), leaf: widest(s, 'leaf:') }]),
  ) as Record<Side, { socketHalf: number; adapter: number; leaf: number }>

  const planned: Planned[] = []
  const edgePlan: Array<[string, string, string?]> = []
  const slotRows = new Map<string, number>()
  for (const side of SIDES) {
    const col = columns[side]
    const inward = side === 'driving'
    const leafKind: NodeKind = inward ? 'actor' : 'external'
    const yOf = (row: number) => (row - col.rows / 2 + 0.5) * ROW
    const plan = (key: string, ref: string, kind: NodeKind, y: number, height?: number) => {
      const f = frameOf.get(kind === leafKind ? `leaf:${ref}` : key)!
      planned.push({ key, ref, kind, side, y, frame: f, height: height ?? f.height })
    }
    let row = 0
    for (const group of col.groups) {
      const start = row
      const adapterKeys: string[] = []
      for (const { adapter, leaves } of group.slots) {
        const span = Math.max(1, leaves.length)
        const key = `adapter:${adapter.id}`
        plan(key, adapter.id, 'adapter', (yOf(row) + yOf(row + span - 1)) / 2)
        slotRows.set(key, span)
        adapterKeys.push(key)
        leaves.forEach((leaf, i) => {
          const leafKey = `${leafKind}:${leaf.id}`
          plan(leafKey, leaf.id, leafKind, yOf(row + i))
          edgePlan.push(inward ? [leafKey, key] : [key, leafKey])
        })
        row += span
      }
      if (!group.slots.length) row += 1
      if (!group.port) continue
      const portKey = `port:${group.port.id}`
      plan(portKey, group.port.id, 'port', (yOf(start) + yOf(row - 1)) / 2, overview ? undefined : (row - start) * ROW - ROW_GAP)
      for (const key of adapterKeys) edgePlan.push([key, portKey])
      if (!overview && group.port.useCaseId && d.useCases.some((u) => u.id === group.port!.useCaseId)) {
        const ucKey = `useCase:${group.port.useCaseId}`
        edgePlan.push(inward ? [portKey, ucKey, labels.runs] : [ucKey, portKey, labels.uses])
      }
    }
    col.loose.forEach((leaf, i) => plan(`${leafKind}:${leaf.id}`, leaf.id, leafKind, yOf(row + i)))
  }
  const of = (kind: NodeKind) => planned.filter((p) => p.kind === kind)

  // 2b. Slanted walls: the same port → adapter → endpoint groups, laid in lanes along the wall (u) and stepped out
  // along its normal (v). Sockets straddle the application wall; endpoints sit outside the outer ring.
  interface WallBox {
    key: string
    ref: string
    kind: NodeKind
    side: Side
    wall: Wall
    frame: Frame
    u: number
    v: number
    /** v counts from the outer ring's wall rather than the application ring's. */
    outer: boolean
    width: number
    height: number
  }
  const wallBoxes: WallBox[] = []
  for (const wall of [...SLANTED_WALLS]) {
    const onWall = slantedPorts.filter((p) => wallOf(p) === wall)
    if (!onWall.length) continue
    const side = onWall[0].side
    const inward = side === 'driving'
    const leafKind: NodeKind = inward ? 'actor' : 'external'
    const { n, dir } = wallFrame(wall)
    const groups = portGroups(d, side, onWall)
    const lanes = groups.reduce((k, g) => k + groupRows(g), 0)
    const boxes = groups.flatMap((g) => g.slots.flatMap((s) => [adapterFrame(s.adapter, side), ...s.leaves.map((l) => leafFrame(l, side))]))
    const socketLength = (f: Frame) => (overview ? NOTCH.height : f.width)
    const pitch =
      Math.max(36, ...boxes.map((f) => 2 * reach(f.width, f.height, dir)), ...onWall.map((p) => socketLength(socketFrame(p)))) + ROW_GAP
    const uOf = (lane: number) => (lane - (lanes - 1) / 2) * pitch
    let lane = 0
    for (const group of groups) {
      const port = group.port!
      const start = lane
      const socket = socketFrame(port)
      const thickness = overview ? NOTCH.width : socket.height
      const adapterKeys: string[] = []
      for (const { adapter, leaves } of group.slots) {
        const span = Math.max(1, leaves.length)
        const f = adapterFrame(adapter, side)
        const key = `adapter:${adapter.id}`
        wallBoxes.push({ key, ref: adapter.id, kind: 'adapter', side, wall, frame: f, u: (uOf(lane) + uOf(lane + span - 1)) / 2, v: thickness / 2 + GAP + reach(f.width, f.height, n), outer: false, width: f.width, height: f.height })
        adapterKeys.push(key)
        leaves.forEach((leaf, i) => {
          const lf = leafFrame(leaf, side)
          const leafKey = `${leafKind}:${leaf.id}`
          wallBoxes.push({ key: leafKey, ref: leaf.id, kind: leafKind, side, wall, frame: lf, u: uOf(lane + i), v: OUTSIDE_GAP + reach(lf.width, lf.height, n), outer: true, width: lf.width, height: lf.height })
          edgePlan.push(inward ? [leafKey, key] : [key, leafKey])
        })
        lane += span
      }
      if (!group.slots.length) lane += 1
      const portKey = `port:${port.id}`
      const length = overview ? NOTCH.height : Math.max(socketLength(socket), (lane - start) * pitch - ROW_GAP)
      wallBoxes.push({ key: portKey, ref: port.id, kind: 'port', side, wall, frame: socket, u: (uOf(start) + uOf(lane - 1)) / 2, v: 0, outer: false, width: length, height: thickness })
      for (const key of adapterKeys) edgePlan.push([key, portKey])
      if (!overview && port.useCaseId && d.useCases.some((u) => u.id === port.useCaseId)) {
        const ucKey = `useCase:${port.useCaseId}`
        edgePlan.push(inward ? [portKey, ucKey, labels.runs] : [ucKey, portKey, labels.uses])
      }
    }
  }
  /** A wall box's corners in its wall frame: u along the wall, v off the wall line it counts from. */
  const localCorners = (b: WallBox) => {
    const { n, dir } = wallFrame(b.wall)
    if (b.kind === 'port') return [-1, 1].flatMap((su) => [-1, 1].map((sv) => ({ u: b.u + (su * b.width) / 2, v: (sv * b.height) / 2 })))
    return rectCorners(0, 0, b.width, b.height).map((c) => ({ u: b.u + dot(c, dir), v: b.v + dot(c, n) }))
  }
  // Once any wall is slanted, the w/e columns keep to their sectors too, so no two walls' boxes can meet.
  const columnCorners = (kind: NodeKind, v: (p: Planned) => number[]) =>
    planned
      .filter((p) => p.kind === kind)
      .flatMap((p) => [p.y - p.height / 2, p.y + p.height / 2].flatMap((y) => v(p).map((vv) => ({ u: y, v: vv }))))

  // 3. Centre blocks. The domain tree is drawn as centred lines: a root shows its name and type, each descendant
  // one smaller line. Past DOMAIN_MAX_LINES the tree flows into two balanced columns, never splitting a root from
  // its descendants; a declared-port list longer than PORTS_MAX_LINES splits the same way.
  const splitServices = config.rings.some((r) => r.role === 'domainServices')
  const coreItems = d.domain.filter((i) => !splitServices || i.type !== 'domainService')
  const serviceItems = splitServices ? d.domain.filter((i) => i.type === 'domainService') : []
  const serviceFrames = serviceItems.map(domainFrame)
  const coreIds = new Set(coreItems.map((i) => i.id))
  const childrenOf = (id: string | undefined) =>
    coreItems.filter((i) => (i.parentId && coreIds.has(i.parentId) ? i.parentId : undefined) === id)
  interface Row {
    key: string
    ref: string
    kind: NodeKind
    frame: Frame
  }
  const itemFrame = (item: DomainItem, depth: number) =>
    depth === 0 ? domainFrame(item) : frame([{ text: item.name, style: 'minor', tag: DOMAIN_TAGS[item.type] }], 0, 2, 0)
  const walk = (item: DomainItem, depth: number): Row[] => [
    { key: `domainItem:${item.id}`, ref: item.id, kind: 'domainItem', frame: itemFrame(item, depth) },
    ...childrenOf(item.id).flatMap((child) => walk(child, depth + 1)),
  ]
  /** A root and its descendants, kept together; an aggregate root also gets an outline around the block. */
  interface Block {
    rows: Row[]
    aggregate?: DomainItem
  }
  const roots = childrenOf(undefined)
  const treeBlocks: Block[] = overview
    ? // The overview domain is a plain list of its aggregate and entity roots.
      roots
        .filter((r) => r.type === 'aggregate' || r.type === 'entity')
        .map((r) => ({ rows: [{ key: `domainItem:${r.id}`, ref: r.id, kind: 'domainItem', frame: frame(styled(r.type === 'aggregate' ? 'strong' : 'mono', r.name), 0, 2, 0) }] }))
    : [...roots.filter((r) => r.type !== 'domainService'), ...roots.filter((r) => r.type === 'domainService')].map((r) => ({
        rows: walk(r, 0),
        aggregate: r.type === 'aggregate' ? r : undefined,
      }))
  const declared = config.drivenPortNote && !overview ? d.ports.filter((p) => p.side === 'driven') : []
  const portBlocks: Block[] = declared.map((p) => ({
    rows: [{ key: `portDecl:${p.id}`, ref: p.id, kind: 'portDecl', frame: frame(styled('mono', p.name), 0, 2, 0) }],
  }))

  // Layer titles: the kind's defaults, overridden per diagram; an empty override falls back to the default. Layer
  // titles are uppercase and tracked; the domain's is the one big sentence-case heading.
  const last = config.rings.length - 1
  const titleMetrics = (i: number) => (i === last ? DOMAIN_TITLE : RING_LABEL)
  const titleLine = (i: number) => titleMetrics(i).size + 4
  const ringTitle = (i: number) => {
    const spec = config.rings[i]
    const override = d.layers?.[spec.role]
    const title = override?.title?.trim() || spec.name
    return { title: i === last ? title : title.toUpperCase(), subtitle: override?.subtitle?.trim() || spec.subtitle }
  }
  const titleWidth = (i: number) => {
    const { title, subtitle } = ringTitle(i)
    return Math.max(measure(title, titleMetrics(i)), subtitle ? measure(subtitle, RING_SUBTITLE) : 0)
  }
  const titleHeight = (i: number) => titleLine(i) + (ringTitle(i).subtitle ? SUBTITLE_GAP + RING_SUBTITLE.size + 4 : 0)
  // One title depth for every ring: the depth under a hexagon's vertex where the widest title fits the slope.
  const TITLE_DEPTH = Math.max(LABEL_INSET, ...config.rings.map((_, i) => (titleWidth(i) / 2 + LABEL_PAD_X) / SQRT3))

  // The domain block hangs from its title: `top` is measured from the title's top, `x` is a column centre.
  interface Placed extends Row {
    x: number
    top: number
  }
  const tagFrame = frame(styled('tag', DOMAIN_TAGS.aggregate), 0, 0, 0)
  const blockSize = (b: Block) => {
    const width = Math.max(0, ...b.rows.map((r) => r.frame.width))
    const height = b.rows.reduce((h, r) => h + r.frame.height, 0)
    return b.aggregate
      ? { width: Math.max(width, tagFrame.width) + 2 * OUTLINE_PAD, height: height + tagFrame.height + 2 * OUTLINE_PAD }
      : { width, height }
  }
  const lineCount = (blocks: Block[]) => blocks.reduce((n, b) => n + b.rows.reduce((k, r) => k + r.frame.lines.length, 0), 0)
  const columnsOf = (blocks: Block[], maxLines: number): Block[][] => {
    const total = lineCount(blocks)
    if (total <= maxLines || blocks.length < 2) return [blocks]
    // Order-preserving split at the block boundary with the most even line counts.
    let split = 1
    for (let k = 2; k < blocks.length; k++) {
      if (Math.abs(total - 2 * lineCount(blocks.slice(0, k))) < Math.abs(total - 2 * lineCount(blocks.slice(0, split)))) split = k
    }
    return [blocks.slice(0, split), blocks.slice(split)]
  }
  const layColumns = (columns: Block[][], top: number) => {
    const widths = columns.map((c) => Math.max(0, ...c.map((b) => blockSize(b).width)))
    let left = -(widths.reduce((a, b) => a + b, 0) + COLUMN_GAP * (columns.length - 1)) / 2
    const rows: Placed[] = []
    const outlines: Placed[] = []
    let height = 0
    columns.forEach((column, c) => {
      const x = left + widths[c] / 2
      let y = top
      column.forEach((block, k) => {
        if (k > 0 && (block.aggregate || column[k - 1].aggregate)) y += BLOCK_GAP
        const size = blockSize(block)
        if (block.aggregate) {
          const outline = { lines: tagFrame.lines, width: size.width, height: size.height }
          outlines.push({ key: `aggregate:${block.aggregate.id}`, ref: block.aggregate.id, kind: 'aggregate', frame: outline, x, top: y })
        }
        let rowTop = y + (block.aggregate ? OUTLINE_PAD + tagFrame.height : 0)
        for (const r of block.rows) {
          rows.push({ ...r, x, top: rowTop })
          rowTop += r.frame.height
        }
        y += size.height
      })
      height = Math.max(height, y - top)
      left += widths[c] + COLUMN_GAP
    })
    return { rows, outlines, height }
  }
  const tree = layColumns(columnsOf(treeBlocks, DOMAIN_MAX_LINES), titleHeight(last) + 8)
  const header: Row | undefined =
    config.drivenPortNote && portBlocks.length
      ? { key: 'note:driven-ports', ref: 'driven-ports', kind: 'note', frame: frame(styled('mono', config.drivenPortNote.title), 0, 2, 0) }
      : undefined
  const headerTop = titleHeight(last) + 8 + tree.height + (tree.rows.length ? 6 : 0)
  const portList = layColumns(columnsOf(portBlocks, PORTS_MAX_LINES), headerTop + (header?.frame.height ?? 0))
  const coreRows: Placed[] = [...tree.rows, ...(header ? [{ ...header, x: 0, top: headerTop }] : []), ...portList.rows]
  const coreBoxes: Placed[] = [...tree.outlines, ...coreRows]
  const servicesBlock = {
    width: Math.max(0, ...serviceFrames.map((f) => f.width)),
    height: serviceFrames.reduce((h, f) => h + f.height, 0),
  }
  const useCaseFrames = d.useCases.map((u) => {
    if (overview) return nameFrame(u.name)
    const [signature, ...steps] = (u.note ?? '').split('\n')
    return frame([...styled('tag', USE_CASE_TAG), ...styled('name', u.name), ...styled('mono', signature, 34), ...steps.flatMap((s) => styled('muted', s, 34))], 120)
  })
  const useCaseBlock = {
    width: Math.max(0, ...useCaseFrames.map((f) => f.width)),
    height: useCaseFrames.reduce((h, f) => h + f.height, 0) + GAP * Math.max(0, useCaseFrames.length - 1),
  }

  // Use-case buses: one vertical lane per use case and side, between the inner ring and the sockets. The top
  // use case takes the outermost lane so no exit crosses another bus, and the exit run fits the lane's verb.
  const laneVerb: Record<Side, string> = { driving: labels.runs, driven: labels.uses }
  const busX = (side: Side, k: number, innerHalfWidth: number) =>
    // The driven side also keeps one lane per declared port, for the dotted ownership links.
    Math.max(innerHalfWidth + LANE * (1 + (side === 'driven' ? declared.length : 0)), useCaseBlock.width / 2 + measure(laneVerb[side], EDGE_LABEL) + 2 * LANE) +
    LANE * (useCaseFrames.length - 1 - k)
  const socketClearance = (side: Side, innerHalfWidth: number) =>
    useCaseFrames.length && !overview ? busX(side, 0, innerHalfWidth) + RUN : 0
  const useCaseOffsets = useCaseFrames.map((_, i) =>
    useCaseFrames.slice(0, i).reduce((o, f) => o + f.height + GAP, 0),
  )

  // A hexagon is no wider at a fixed depth under its vertex however big it grows, so a box too wide for the slope
  // just under the title can only fit lower: the body (never the title) drops until every box clears the slope.
  const bodyShift = (o: Outline) =>
    Math.max(0, ...coreBoxes.map((r) => depthAt(shape, o, Math.abs(r.x) + r.frame.width / 2 + DOMAIN_PAD) - (TITLE_DEPTH + r.top)))
  let domainShift = 0

  /** Use-case centres under the application title for a given application ring (see placement below). */
  const useCaseCentres = (appO: Outline, insideO: Outline) => {
    const titleBottom = TITLE_DEPTH + titleHeight(appIndex)
    const depth = Math.max(
      titleBottom + GAP,
      ...useCaseFrames.flatMap((f, k) => [
        depthAt(shape, appO, useCaseBlock.width / 2 + PAD) - useCaseOffsets[k],
        ...SIDES.map((s) => depthAt(shape, appO, busX(s, k, insideO.halfWidth) + PAD) - useCaseOffsets[k] - f.height / 2),
      ]),
    )
    let y = -appO.apex + depth
    return useCaseFrames.map((f) => {
      const centre = y + f.height / 2
      y += f.height + GAP
      return centre
    })
  }
  /** A segment as a hairline quad, so the same separating-axis test covers runs and boxes. */
  const hairline = (a: Point, b: Point): Point[] => {
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const [nx, ny] = [(-(b.y - a.y) / len) * 0.5, ((b.x - a.x) / len) * 0.5]
    return [
      { x: a.x + nx, y: a.y + ny },
      { x: b.x + nx, y: b.y + ny },
      { x: b.x - nx, y: b.y - ny },
      { x: a.x - nx, y: a.y - ny },
    ]
  }
  /**
   * For a candidate application ring: does a slanted-wall socket touch a use case, the title, or a use-case run
   * (bus lane, branch or wall-normal run) that is not its own? The upper walls lean in exactly where the buses
   * come down from the use cases, so this is what usually sizes the ring once they are used.
   */
  const appClashes = (appO: Outline, insideO: Outline) => {
    const slantedSocket = wallBoxes
      .filter((b) => b.kind === 'port')
      .map((b) => {
        const { n, dir } = wallFrame(b.wall)
        const centre = { x: n.x * appO.halfWidth + dir.x * b.u, y: n.y * appO.halfWidth + dir.y * b.u }
        const face = { x: n.x * (appO.halfWidth - b.height / 2) + dir.x * b.u, y: n.y * (appO.halfWidth - b.height / 2) + dir.y * b.u }
        return { ref: b.ref, side: b.side, wall: b.wall, face, quad: rectCorners(centre.x, centre.y, b.width, b.height, wallAngle(b.wall)) }
      })
    const ucY = useCaseCentres(appO, insideO)
    const others = [
      rectCorners(0, -appO.apex + TITLE_DEPTH + titleHeight(appIndex) / 2, titleWidth(appIndex), titleHeight(appIndex)),
      ...ucY.map((y, k) => rectCorners(0, y, useCaseFrames[k].width, useCaseFrames[k].height)),
    ]
    if (slantedSocket.some((s) => others.some((o) => quadsOverlap(s.quad, o)))) return true
    if (overview) return false
    // Every use-case run, tagged with the port it serves.
    const runs: { ref: string; quad: Point[] }[] = []
    for (const port of d.ports) {
      const k = d.useCases.findIndex((u) => u.id === port.useCaseId)
      if (k < 0) continue
      const sign = port.side === 'driving' ? -1 : 1
      const lane = sign * busX(port.side, k, insideO.halfWidth)
      const slanted = slantedSocket.find((s) => s.ref === port.id)
      if (slanted) {
        const { n } = wallFrame(slanted.wall)
        const reach = (slanted.face.x - lane) / n.x
        const foot = { x: lane, y: slanted.face.y - n.y * reach }
        runs.push({ ref: port.id, quad: hairline({ x: lane, y: ucY[k] }, foot) }, { ref: port.id, quad: hairline(foot, slanted.face) })
      } else {
        const socket = planned.find((p) => p.key === `port:${port.id}`)
        if (!socket) continue
        const inner = sign * (appO.halfWidth - widths[port.side].socketHalf)
        runs.push({ ref: port.id, quad: hairline({ x: lane, y: ucY[k] }, { x: lane, y: socket.y }) }, { ref: port.id, quad: hairline({ x: lane, y: socket.y }, { x: inner, y: socket.y }) })
      }
    }
    return slantedSocket.some((s) => runs.some((r) => r.ref !== s.ref && quadsOverlap(s.quad, r.quad)))
  }

  // 4. Rings, inside-out: each one holds its own content, fitted to the real box corners. The stack above the
  // inner ring (use cases, then the title) is absolute here; titles move up under the top vertex afterwards.
  const outlines: Outline[] = []
  const appIndex = config.rings.findIndex((r) => r.role === 'application')
  const leafX = (side: Side) => {
    const w = widths[side]
    if (!config.endpointsInside) return outlines[0].halfWidth + OUTSIDE_GAP + w.leaf / 2
    if (config.rings[0].role === 'outer') return outlines[1].halfWidth + GAP + w.leaf / 2
    return outlines[appIndex].halfWidth + w.socketHalf + GAP + w.adapter + GAP + w.leaf / 2
  }
  const leafNeeds = (side: Side): Need[] =>
    [...of('actor'), ...of('external')]
      .filter((p) => p.side === side)
      .map((p) => ({ x: leafX(side) + widths[side].leaf / 2 + PAD, y: farthest(p.y, p.height) }))

  for (let i = last; i >= 0; i--) {
    const role = config.rings[i].role
    const inner = outlines[i + 1]
    if (role === 'domain') {
      // The block hangs TITLE_DEPTH under the apex, so its corners move with the radius; the width at a fixed
      // depth under the apex only grows with r, which makes the smallest fitting radius a binary search.
      const outline = (r: number) => (shape === 'circle' ? circle(r) : hexagon(r))
      const fits = (o: Outline) => {
        const top = -o.apex + TITLE_DEPTH
        const shift = bodyShift(o)
        const boxes = [
          { x: titleWidth(i) / 2 + LABEL_PAD_X, from: 0, to: titleHeight(i) },
          ...coreBoxes.map((r) => ({ x: Math.abs(r.x) + r.frame.width / 2 + DOMAIN_PAD, from: r.top + shift, to: r.top + shift + r.frame.height })),
        ]
        // The title stays in the upper half even when the domain is empty, so it never floats mid-ring.
        const titleUp = top + titleHeight(i) <= -LABEL_LINE / 2
        // A body shifted onto the slope touches it exactly; the tolerance keeps that tangency from failing on rounding.
        return titleUp && boxes.every((b) => [top + b.from, top + b.to].every((y) => Math.abs(y) <= o.apex + 1e-6 && halfWidthAt(shape, o, y) >= b.x - 1e-6))
      }
      let [lo, hi] = [1, 64]
      while (!fits(outline(hi))) hi *= 2
      for (let n = 0; n < 50; n++) {
        const mid = (lo + hi) / 2
        if (fits(outline(mid))) hi = mid
        else lo = mid
      }
      outlines[i] = outline(hi)
      domainShift = bodyShift(outlines[i])
      continue
    }
    const side: Need[] = []
    const vertical: Need[] = []
    let stackTop = inner.apex
    if (role === 'domainServices' && serviceFrames.length) {
      stackTop += GAP + servicesBlock.height
      vertical.push({ x: servicesBlock.width / 2 + PAD, y: stackTop })
    }
    if (role === 'application') {
      for (const p of of('port')) {
        const clear = Math.max(halfWidthAt(shape, inner, nearest(p.y, p.height)) + GAP, socketClearance(p.side, inner.halfWidth))
        side.push({ x: clear + widths[p.side].socketHalf, y: farthest(p.y, p.height) })
      }
      if (useCaseFrames.length) {
        const blockTop = inner.apex + (overview ? GAP : DOMAIN_RUN) + useCaseBlock.height
        vertical.push({ x: useCaseBlock.width / 2 + PAD, y: blockTop })
        if (!overview) {
          useCaseFrames.forEach((f, k) => {
            const centre = blockTop - useCaseOffsets[k] - f.height / 2
            for (const s of SIDES) vertical.push({ x: busX(s, k, inner.halfWidth) + PAD, y: centre })
          })
        }
        stackTop = blockTop
      }
    }
    vertical.push({ x: 0, y: stackTop + GAP + titleHeight(i) + TITLE_DEPTH })
    if (role === 'adapters') {
      for (const p of of('adapter')) {
        const w = widths[p.side]
        side.push({ x: halfWidthAt(shape, inner, p.y) + w.socketHalf + GAP + w.adapter + PAD, y: farthest(p.y, p.height) })
      }
    }
    if (i === 0 && config.endpointsInside) side.push(...leafNeeds('driving'), ...leafNeeds('driven'))
    let minApothem = 0
    if (shape === 'hexagon' && role === 'application') {
      for (const b of wallBoxes.filter((b) => !b.outer)) for (const c of localCorners(b)) minApothem = Math.max(minApothem, sectorApothem(c.u, c.v))
      for (const b of wallBoxes.filter((b) => b.kind === 'port')) {
        minApothem = Math.max(minApothem, inner.halfWidth + GAP + b.height / 2)
        const port = d.ports.find((p) => p.id === b.ref)!
        const k = d.useCases.findIndex((u) => u.id === port.useCaseId)
        if (k >= 0 && !overview) {
          // The run from the bus lane to the socket, along the wall normal, keeps at least RUN.
          const { n, dir } = wallFrame(b.wall)
          const bus = (b.side === 'driving' ? -1 : 1) * busX(b.side, k, inner.halfWidth)
          minApothem = Math.max(minApothem, (bus + RUN * n.x - b.u * dir.x) / n.x + b.height / 2)
        }
      }
      if (hasSlanted) {
        for (const c of columnCorners('port', (p) => [-widths[p.side].socketHalf, widths[p.side].socketHalf])) minApothem = Math.max(minApothem, sectorApothem(c.u, c.v))
        for (const c of columnCorners('adapter', (p) => [widths[p.side].socketHalf + GAP])) minApothem = Math.max(minApothem, sectorApothem(c.u, c.v))
      }
    }
    if (shape === 'hexagon' && role === 'adapters') {
      const appApothem = inner.halfWidth
      for (const b of wallBoxes.filter((b) => b.kind === 'adapter')) for (const c of localCorners(b)) minApothem = Math.max(minApothem, appApothem + c.v + PAD)
      for (const b of wallBoxes.filter((b) => b.outer)) for (const c of localCorners(b)) minApothem = Math.max(minApothem, sectorApothem(c.u, c.v))
      if (hasSlanted) for (const c of columnCorners('actor', () => [OUTSIDE_GAP]).concat(columnCorners('external', () => [OUTSIDE_GAP]))) minApothem = Math.max(minApothem, sectorApothem(c.u, c.v))
    }
    let fitted = fitRing(shape, inner, side, vertical, minApothem)
    // Sockets on the upper walls lean in toward the use cases and the title: grow until none of them touch.
    if (shape === 'hexagon' && role === 'application' && hasSlanted) {
      for (let guard = 0; guard < 400 && appClashes(fitted, inner); guard++) fitted = hexagon(fitted.apex * 1.01)
    }
    // The title must fit TITLE_DEPTH under the top: a circle grows until its chord there is wide enough; a
    // hexagon's slope already is by construction, so only its straight width can bind.
    const w = titleWidth(i) / 2 + LABEL_PAD_X
    outlines[i] =
      shape === 'circle'
        ? circle(Math.max(fitted.apex, (w * w + TITLE_DEPTH * TITLE_DEPTH) / (2 * TITLE_DEPTH)))
        : hexagon(Math.max(fitted.apex, w / COS30))
  }

  const app = outlines[appIndex]
  const insideApp = outlines[appIndex + 1]
  const outer = outlines[0]
  const domain = outlines[last]

  // 5. Nodes and edges.
  const nodes: LayoutNode[] = []
  const add = (n: LayoutNode) => (nodes.push(n), n)
  const place = (key: string, ref: string, kind: NodeKind, tone: Tone, f: Frame, x: number, y: number, side?: Side) =>
    add({ key, ref, kind, tone, lines: f.lines, side, x, y, width: f.width, height: f.height })

  const rings: LayoutRing[] = config.rings.map((spec, i) => ({
    key: `ring:${spec.role}`,
    role: spec.role,
    ...ringTitle(i),
    ...outlines[i],
    labelAt: { x: 0, y: -outlines[i].apex + TITLE_DEPTH + titleLine(i) / 2 },
  }))

  const blockTop = -domain.apex + TITLE_DEPTH
  // Outlines first so they draw under the lines they enclose.
  for (const r of coreBoxes) {
    const node = place(r.key, r.ref, r.kind, 'domain', r.frame, r.x, blockTop + domainShift + r.top + r.frame.height / 2)
    if (r.kind !== 'aggregate') node.align = 'center'
  }
  let y = 0
  y = -(domain.apex + GAP + servicesBlock.height)
  serviceItems.forEach((item, i) => {
    const f = serviceFrames[i]
    place(`domainItem:${item.id}`, item.id, 'domainItem', 'domain', f, 0, y + f.height / 2)
    y += f.height
  })
  // Use cases hang right under the application title, lowered only where the ring is too narrow for a box or
  // for its bus corners; the solver guaranteed the stacked position fits, so this never goes below it.
  const ucCentres = useCaseCentres(app, insideApp)
  d.useCases.forEach((u, i) => {
    place(`useCase:${u.id}`, u.id, 'useCase', 'teal', useCaseFrames[i], 0, ucCentres[i]).align = 'center'
  })

  // Column items of a hexagon sit on the w or e wall when they belong to a port (unassigned ones have no wall).
  const endpointAdapter = new Map([...d.actors, ...d.externals].map((e) => [e.id, e.adapterId]))
  const columnWall = (p: Planned): Wall | undefined => {
    if (shape !== 'hexagon') return undefined
    const adapterId = p.kind === 'adapter' ? p.ref : p.kind === 'port' ? undefined : endpointAdapter.get(p.ref)
    const linked = p.kind === 'port' || !!(adapterId && portOf(d.adapters.find((a) => a.id === adapterId)!))
    return linked ? defaultWall(p.side) : undefined
  }
  for (const p of planned) {
    const sign = p.side === 'driving' ? -1 : 1
    const w = widths[p.side]
    const edge = halfWidthAt(shape, app, p.y)
    const x =
      p.kind === 'port'
        ? sign * edge
        : p.kind === 'adapter'
          ? sign * (edge + w.socketHalf + GAP + w.adapter / 2)
          : sign * leafX(p.side)
    const width = p.kind === 'port' ? w.socketHalf * 2 : p.kind === 'adapter' ? w.adapter : w.leaf
    const tone: Tone = p.kind === 'port' ? 'teal' : p.kind === 'external' ? 'slate' : p.side
    add({ key: p.key, ref: p.ref, kind: p.kind, tone, lines: p.frame.lines, align: 'center', side: p.side, wall: columnWall(p), x, y: p.y, width, height: p.height })
  }
  for (const b of wallBoxes) {
    const { n, dir } = wallFrame(b.wall)
    const depth = (b.outer ? outer.halfWidth : app.halfWidth) + b.v
    const tone: Tone = b.kind === 'port' ? 'teal' : b.kind === 'external' ? 'slate' : b.side
    add({
      key: b.key,
      ref: b.ref,
      kind: b.kind,
      tone,
      lines: b.frame.lines,
      align: 'center',
      side: b.side,
      wall: b.wall,
      rotation: b.kind === 'port' ? wallAngle(b.wall) : undefined,
      x: n.x * depth + dir.x * b.u,
      y: n.y * depth + dir.y * b.u,
      width: b.width,
      height: b.height,
    })
  }

  const byKey = new Map(nodes.map((n) => [n.key, n]))
  const faceX = (n: LayoutNode, towardX: number) => n.x + (Math.sign(towardX - n.x) * n.width) / 2

  /** Side-by-side boxes: one straight run where their heights overlap, otherwise a Z with a mid-gap elbow. */
  const horizontal = (a: LayoutNode, b: LayoutNode): Point[] => {
    const ax = faceX(a, b.x)
    const bx = faceX(b, a.x)
    const low = Math.max(a.y - a.height / 2, b.y - b.height / 2) + 4
    const high = Math.min(a.y + a.height / 2, b.y + b.height / 2) - 4
    if (low <= high) {
      const y = Math.min(Math.max(a.y, low), high)
      return [{ x: ax, y }, { x: bx, y }]
    }
    const mx = (ax + bx) / 2
    return [{ x: ax, y: a.y }, { x: mx, y: a.y }, { x: mx, y: b.y }, { x: bx, y: b.y }]
  }

  /** Use case → bus → socket: sideways out of the use case, down its lane, then straight into the socket. */
  const busRoute = (useCase: LayoutNode, socket: LayoutNode): Point[] => {
    const side = socket.side ?? 'driven'
    const sign = side === 'driving' ? -1 : 1
    const lane = sign * busX(side, d.useCases.findIndex((u) => `useCase:${u.id}` === useCase.key), insideApp.halfWidth)
    return [
      { x: useCase.x + (sign * useCase.width) / 2, y: useCase.y },
      { x: lane, y: useCase.y },
      { x: lane, y: socket.y },
      { x: socket.x - (sign * socket.width) / 2, y: socket.y },
    ]
  }

  const slantedWall = (n: LayoutNode) => (n.wall && SLANTED_WALLS.has(n.wall) ? n.wall : undefined)
  /** A point on a socket's inner (−1) or outer (+1) face, at lane u along its wall. */
  const socketFace = (socket: LayoutNode, face: 1 | -1, u: number) => {
    const { n, dir } = wallFrame(socket.wall!)
    const depth = app.halfWidth + (face * socket.height) / 2
    return { x: n.x * depth + dir.x * u, y: n.y * depth + dir.y * u }
  }

  /**
   * Slanted walls: socket, adapter and endpoint connect along the wall normal, on the lane of the outer box of the
   * pair, so each run is perpendicular to the wall and every box stays upright.
   */
  const alongNormal = (a: LayoutNode, b: LayoutNode): Point[] => {
    const wall = slantedWall(a) ?? slantedWall(b)!
    const { n, dir } = wallFrame(wall)
    const [outerBox, innerBox] = dot(a, n) > dot(b, n) ? [a, b] : [b, a]
    const back = { x: -n.x, y: -n.y }
    const exit = enterBox(outerBox, { x: outerBox.x + back.x * 1e4, y: outerBox.y + back.y * 1e4 }, n)
    const entry = innerBox.kind === 'port' ? socketFace(innerBox, 1, dot(outerBox, dir)) : enterBox(innerBox, exit, back)
    return a === outerBox ? [exit, entry] : [entry, exit]
  }

  /** Use case → bus → slanted socket: out of the use case, along its lane, then along the wall normal. */
  const slantedBusRoute = (useCase: LayoutNode, socket: LayoutNode): Point[] => {
    const [head, lane] = busRoute(useCase, socket)
    const { n, dir } = wallFrame(socket.wall!)
    const q = socketFace(socket, -1, dot(socket, dir))
    const reach = (q.x - lane.x) / n.x
    return [head, lane, { x: lane.x, y: q.y - n.y * reach }, q]
  }

  const labelled = new Set<string>()
  const edges: LayoutEdge[] = edgePlan.map(([fromKey, toKey, label]) => {
    const a = byKey.get(fromKey)!
    const b = byKey.get(toKey)!
    const useCase = [a, b].find((n) => n.kind === 'useCase')
    const socket = [a, b].find((n) => n.kind === 'port')
    const route = useCase && socket ? (slantedWall(socket) ? slantedBusRoute(useCase, socket) : busRoute(useCase, socket)) : undefined
    const direct = slantedWall(a) || slantedWall(b) ? alongNormal(a, b) : horizontal(a, b)
    const points = route ? (a === useCase ? route : [...route].reverse()) : direct
    const edge: LayoutEdge = { key: `${fromKey}->${toKey}`, kind: 'import', points }
    // Every edge of a lane shares its exit run, so the verb is written once, flat above that run.
    const lane = `${useCase?.key}:${socket?.side}`
    if (label && route && !labelled.has(lane)) {
      labelled.add(lane)
      edge.label = label
      edge.labelAt = { x: (route[0].x + route[1].x) / 2, y: route[0].y - 10 }
    }
    return edge
  })

  // Use case → domain: the lowest use case drops straight onto the top of the ring it asks; use cases stacked
  // above it leave sideways, run down beside the stack and merge into that same final run.
  const useCaseNodes = d.useCases.map((u) => byKey.get(`useCase:${u.id}`)!)
  const lowest = useCaseNodes.at(-1)
  if (lowest && !overview) {
    const target = { x: 0, y: -insideApp.apex }
    const start = lowest.y + lowest.height / 2
    const merge = (start + target.y) / 2
    const beside = -(useCaseBlock.width / 2 + LANE)
    for (const u of useCaseNodes) {
      const exitY = u.y + u.height / 4
      const edge: LayoutEdge = {
        key: `${u.key}->domain`,
        kind: 'import',
        points:
          u === lowest
            ? [{ x: 0, y: start }, target]
            : [{ x: u.x - u.width / 2, y: exitY }, { x: beside, y: exitY }, { x: beside, y: merge }, { x: 0, y: merge }, target],
      }
      if (u === lowest) {
        edge.label = labels.asks
        edge.labelAt = { x: -8 - measure(labels.asks, EDGE_LABEL) / 2, y: (start + target.y) / 2 }
      }
      edges.push(edge)
    }
  }

  // Ownership: each driven port declared in the domain links to its socket. Each link gets its own lane between
  // the domain and the bus, and meets the socket a quarter-height below the use-case branch so the two never merge.
  // A declaration in the left column first drops to its row boundary, so it passes between right-column names.
  const declarations = nodes.filter((n) => n.kind === 'portDecl')
  const twoColumns = declarations.some((n) => n.x < 0) && declarations.some((n) => n.x > 0)
  const columnGap = Math.max(-Infinity, ...declarations.filter((n) => n.x < 0).map((n) => n.x + n.width / 2)) + COLUMN_GAP / 2
  const links = declarations.map((declaration) => {
    const socket = byKey.get(`port:${declaration.ref}`)!
    const detour = twoColumns && declaration.x < 0
    const start = { x: declaration.x + declaration.width / 2, y: declaration.y }
    const exitY = detour ? declaration.y + declaration.height / 2 : declaration.y
    const head = detour ? [start, { x: columnGap, y: start.y }, { x: columnGap, y: exitY }] : [start]
    // A slanted socket is met along its wall normal, a quarter of its length off-centre (clear of the use-case run).
    const face = slantedWall(socket) ? socketFace(socket, -1, dot(socket, wallFrame(socket.wall!).dir) + socket.width / 4) : undefined
    return { declaration, socket, head, face, from: exitY, to: face ? face.y : socket.y + socket.height / 4 }
  })
  const ranks = laneOrder(links.map((l) => [l.from, l.to]))
  const isInsideDomain = (p: Point) => Math.abs(p.x) <= halfWidthAt(shape, domain, p.y) && Math.abs(p.y) <= domain.apex
  links.forEach(({ declaration, socket, head, face, from, to }, i) => {
    const lane = insideApp.halfWidth + LANE * (ranks[i] + 1)
    const tail = face
      ? (() => {
          const { n } = wallFrame(socket.wall!)
          const reach = (face.x - lane) / n.x
          return [{ x: lane, y: face.y - n.y * reach }, face]
        })()
      : [{ x: lane, y: to }, { x: socket.x - socket.width / 2, y: to }]
    const points = dedupe([...head, { x: lane, y: from }, ...tail])
    // Insert the point where the path leaves the domain fill, found by bisecting the segment that crosses it.
    const crossing = points.findIndex((p, k) => k > 0 && isInsideDomain(points[k - 1]) && !isInsideDomain(p))
    let insideTo: number | undefined
    if (crossing > 0) {
      const [a, b] = [points[crossing - 1], points[crossing]]
      const at = (t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
      let [lo, hi] = [0, 1]
      for (let n = 0; n < 50; n++) {
        const mid = (lo + hi) / 2
        if (isInsideDomain(at(mid))) lo = mid
        else hi = mid
      }
      points.splice(crossing, 0, at(lo))
      insideTo = crossing
    }
    edges.push({ key: `${declaration.key}->${socket.key}`, kind: 'declares', points, insideTo })
  })

  if (d.composition && !overview) {
    const f = frame([...styled('mono', d.composition.name), ...noteLines(d.composition.note)], 120)
    const root = place('composition', 'composition', 'composition', 'muted', f, 0, outer.apex + GAP + f.height / 2)
    root.align = 'center'
    if (shape === 'hexagon') {
      // Hexagon: one trunk per side hugging the outer ring, just inside the endpoints. Each branch runs in along its
      // wall's normal to the adapter's outer face, a quarter of the box off the endpoint arrow, so it meets no box.
      const r = outer.apex + TRUNK_GAP / COS30
      const vertex = (k: number) => ({ x: r * VERTEX[k].x, y: r * VERTEX[k].y })
      const rootTop = { x: 0, y: root.y - root.height / 2 }
      const walls: Record<Side, Wall[]> = { driving: ['sw', 'w', 'nw'], driven: ['se', 'e', 'ne'] }
      const vertices: Record<Side, number[]> = { driving: [3, 4, 5, 0], driven: [3, 2, 1, 0] }
      for (const side of SIDES) {
        const adapters = nodes.filter((n) => n.kind === 'adapter' && n.side === side && n.wall)
        if (!adapters.length) continue
        const reachWall = Math.max(...adapters.map((a) => walls[side].indexOf(a.wall!)))
        edges.push({
          key: `composition->trunk:${side}`,
          kind: 'wiring',
          points: dedupe([rootTop, ...vertices[side].slice(0, reachWall + 2).map(vertex)]),
        })
        for (const a of adapters) {
          const { n, dir } = wallFrame(a.wall!)
          const lateral = reach(a.width, a.height, dir) / 2
          const onLane = { x: a.x + dir.x * lateral, y: a.y + dir.y * lateral }
          const trunkDepth = outer.halfWidth + TRUNK_GAP
          const start = { x: onLane.x + n.x * (trunkDepth - dot(onLane, n)), y: onLane.y + n.y * (trunkDepth - dot(onLane, n)) }
          edges.push({ key: `composition->${a.key}`, kind: 'wiring', points: [start, enterBox(a, start, { x: -n.x, y: -n.y })] })
        }
      }
    }
    // Circles: one vertical trunk per side just outside the outer ring. Each branch runs inward along the empty row
    // gap under its adapter and turns up into the adapter's bottom edge, so it crosses each ring edge at most once.
    for (const side of shape === 'circle' ? SIDES : []) {
      const adapters = nodes.filter((n) => n.kind === 'adapter' && n.side === side)
      if (!adapters.length) continue
      const sign = side === 'driving' ? -1 : 1
      const trunkX = sign * (outer.halfWidth + (config.endpointsInside ? GAP : OUTSIDE_GAP / 2))
      const gapY = (a: LayoutNode) => a.y + ((slotRows.get(a.key) ?? 1) * ROW) / 2
      edges.push({
        key: `composition->trunk:${side}`,
        kind: 'wiring',
        points: [
          { x: (sign * root.width) / 2, y: root.y },
          { x: trunkX, y: root.y },
          { x: trunkX, y: Math.min(...adapters.map(gapY)) },
        ],
      })
      for (const a of adapters) {
        edges.push({
          key: `composition->${a.key}`,
          kind: 'wiring',
          points: [
            { x: trunkX, y: gapY(a) },
            { x: a.x, y: gapY(a) },
            { x: a.x, y: a.y + a.height / 2 },
          ],
        })
      }
    }
  }

  // 6. Bounds, then the title tucked top-left where the ring slopes away.
  const extent = { left: -outer.halfWidth, right: outer.halfWidth, top: -outer.apex, bottom: outer.apex }
  const grow = (l: number, r: number, t: number, b: number) => {
    extent.left = Math.min(extent.left, l)
    extent.right = Math.max(extent.right, r)
    extent.top = Math.min(extent.top, t)
    extent.bottom = Math.max(extent.bottom, b)
  }
  for (const n of nodes) {
    const c = rectCorners(n.x, n.y, n.width, n.height, n.rotation)
    grow(Math.min(...c.map((p) => p.x)), Math.max(...c.map((p) => p.x)), Math.min(...c.map((p) => p.y)), Math.max(...c.map((p) => p.y)))
  }
  for (const e of edges) {
    if (!e.label || !e.labelAt) continue
    const half = measure(e.label, EDGE_LABEL) / 2
    grow(e.labelAt.x - half, e.labelAt.x + half, e.labelAt.y - EDGE_LABEL.size, e.labelAt.y + EDGE_LABEL.size)
  }

  const texts: LayoutText[] = []
  const heading = [
    ...(d.title ? [{ key: 'title', text: d.title, style: 'title' as const, m: TITLE }] : []),
    ...(d.subtitle ? [{ key: 'subtitle', text: d.subtitle, style: 'subtitle' as const, m: SUBTITLE }] : []),
  ]
  if (heading.length) {
    const blockW = Math.max(...heading.map((t) => measure(t.text, t.m)))
    const blockH = heading.reduce((h, t) => h + t.m.size + 8, 0)
    const x = extent.left
    const clearance = Math.max(...[x, x + blockW, ...(x < 0 && x + blockW > 0 ? [0] : [])].map((px) => topAt(shape, outer, px)))
    let ty = Math.min(extent.top, -clearance - GAP - blockH)
    for (const t of heading) {
      texts.push({ key: t.key, text: t.text, x, y: ty + t.m.size / 2, style: t.style })
      ty += t.m.size + 8
    }
    grow(x, x + blockW, texts[0].y - heading[0].m.size / 2, ty)
  }

  // Layer membership: use cases in application, ports and adapters in the adapter ring, the domain block in the
  // domain (onion's services in their own ring), endpoints only where they sit inside the outermost ring.
  const serviceIds = new Set(serviceItems.map((i) => i.id))
  const layerOf = (n: LayoutNode): RingRole | undefined => {
    if (n.kind === 'useCase') return 'application'
    if (n.kind === 'port' || n.kind === 'adapter') return 'adapters'
    if (n.kind === 'actor' || n.kind === 'external') return config.endpointsInside ? config.rings[0].role : undefined
    if (n.kind === 'composition') return undefined
    return serviceIds.has(n.ref) ? 'domainServices' : 'domain'
  }
  for (const n of nodes) n.layer = layerOf(n)

  // Spokes run along the centre-to-vertex lines, from each outer vertex in to the domain's, never over its fill.
  const guides =
    shape === 'hexagon'
      ? VERTEX.map((v) => ({ from: { x: v.x * outer.apex, y: v.y * outer.apex }, to: { x: v.x * domain.apex, y: v.y * domain.apex } }))
      : []

  return {
    shape,
    rings,
    guides,
    nodes,
    edges,
    texts,
    bounds: {
      x: extent.left - MARGIN,
      y: extent.top - MARGIN,
      width: extent.right - extent.left + 2 * MARGIN,
      height: extent.bottom - extent.top + 2 * MARGIN,
    },
  }
}
