import { HEXAGONAL_KIND, type RingRole } from '../model/kinds'
import { defaultWall, type Adapter, type Diagram, type DomainItem, type Endpoint, type Port, type Side, type UseCase, type Wall } from '../model/schema'
import { dot, hairline, quadsOverlap, reach, rectCorners, type Box, type Point } from './geometry'
import { layoutBounds } from './hexagon/bounds'
import { routeEdges } from './hexagon/routes'
import { COLUMN_GAP, GAP, LANE, OUTSIDE_GAP } from './hexagon/spacing'
import { SLANTED_WALLS, sectorApothem, VERTEX, WALLS, wallAngle, wallFrame } from './hexagon/walls'
import { COS30, depthAt, fitRing, halfWidthAt, hexagon, SQRT3, type Need, type Outline } from './outline'
import { adapterTag, DOMAIN_TAGS, portTag, USE_CASE_TAG } from './tags'
import { DOMAIN_TITLE, EDGE_LABEL, LINE_METRICS, lineWidth, measure, noteLines, RING_LABEL, RING_SUBTITLE, styled, type TextLine } from './text'

export type { Box, Point } from './geometry'

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
  | 'portLabel'

/** Centre-anchored box holding typed text lines. */
export interface LayoutNode {
  key: string
  ref: string
  kind: NodeKind
  tone: Tone
  lines: TextLine[]
  /** 'center' draws every line on the node's x axis; 'start' and 'end' anchor it on the box's left or right edge. */
  align?: 'center' | 'start' | 'end'
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
  role: string
  /** Uppercase layer title, with an optional sentence-case subtitle line under it. */
  title: string
  subtitle?: string
  halfWidth: number
  straight: number
  apex: number
  labelAt: Point
  /** The title and subtitle block, which nothing may cover. */
  titleBox: Box
  /** Onion/Clean only (ADR-01, Decision 7): how many concentric radial lanes this ring's own elements are
   * staggered across (`ringSlotRadius`, layout/ringed.ts) — undefined for Hexagonal, which has no such concept. */
  tracks?: number
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
  /** Font size override; the style's own size when absent. */
  size?: number
}

/** Overview drops everything but names, the rings, notched sockets and the horizontal flow. */
export type LayoutMode = 'detailed' | 'overview'

export interface LayoutOptions {
  mode?: LayoutMode
}

export interface LayoutModel {
  shape: 'hexagon'
  rings: LayoutRing[]
  /** Hexagons only: dashed spokes from each outer vertex in to the matching domain vertex. */
  guides: { from: Point; to: Point }[]
  nodes: LayoutNode[]
  edges: LayoutEdge[]
  texts: LayoutText[]
  bounds: Box
}

const PAD_X = 12
const PAD_Y = 9
const PAD = 16
const ROW_GAP = 18
const DOMAIN_PAD = 24
const LABEL_LINE = RING_LABEL.size + 4
const LABEL_INSET = 8
const LABEL_PAD_X = 8
const SUBTITLE_GAP = 4
const RUN = 16
/** Past these rendered line counts the domain tree, then the declared-port list, flow into two columns. */
const DOMAIN_MAX_LINES = 8
const PORTS_MAX_LINES = 4
/** An aggregate outline: 8 padding all round, plus its tag line above the root. */
const OUTLINE_PAD = 8
const BLOCK_GAP = 6
/** Room between a use case and the ring it asks, for the arrow's straight run and its label. */
const DOMAIN_RUN = 34
/** Between an overview socket's inner face and its port name. */
const LABEL_GAP = 4

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

const SIDES = ['driving', 'driven'] as const
const nearest = (y: number, height: number) => Math.max(0, Math.abs(y) - height / 2)
const farthest = (y: number, height: number) => Math.abs(y) + height / 2

export function layoutDiagram(d: Diagram, { mode = 'detailed' }: LayoutOptions = {}): LayoutModel {
  const overview = mode === 'overview'
  const config = HEXAGONAL_KIND
  const { labels } = config
  const ports = new Map(d.ports.map((p) => [p.id, p]))
  const portOf = (a: Adapter) => (a.portId ? ports.get(a.portId) : undefined)
  const adapterSide = (a: Adapter): Side =>
    portOf(a)?.side ??
    (d.externals.some((e) => e.adapterId === a.id) && !d.actors.some((e) => e.adapterId === a.id) ? 'driven' : 'driving')
  // Hexagons honour each port's wall; circles keep every port in the left or right column.
  const wallOf = (p: Port): Wall => p.wall ?? defaultWall(p.side)
  const slantedPorts = d.ports.filter((p) => SLANTED_WALLS.has(wallOf(p)))
  const slantedAdapters = new Set(d.adapters.filter((a) => slantedPorts.some((p) => p.id === a.portId)).map((a) => a.id))
  const claimed = new Set([...d.actors, ...d.externals].filter((e) => e.adapterId && slantedAdapters.has(e.adapterId)).map((e) => e.id))
  const columnPorts = (side: Side) => d.ports.filter((p) => p.side === side && !SLANTED_WALLS.has(wallOf(p)))
  const columns: Record<Side, Column> = {
    driving: buildColumn(d, 'driving', columnPorts('driving'), adapterSide, portOf, claimed),
    driven: buildColumn(d, 'driven', columnPorts('driven'), adapterSide, portOf, claimed),
  }
  const hasSlanted = slantedPorts.length > 0
  // Once any wall hosts something of its own (a slanted port, a seated use case), w/e column content keeps to its
  // sector too, so no two walls' content can meet.
  const sectored = hasSlanted || d.useCases.some((u) => u.placement && u.placement !== 'top')

  // 1. Box contents: every size below derives from the text a box has to hold.
  // Overview pills carry the name only, unwrapped; its sockets are bare notches on the ring edge.
  const nameFrame = (name: string) => frame(styled('name', name), 80)
  const NOTCH: Frame = { lines: [], width: 14, height: 30 }
  // With the socket only a notch, the port name (the contract) sits beside it, inside the application ring.
  const portLabel = (p: Port) => frame(styled('label', p.name), 0, 0, 0)
  const labelReach = (p: Port) => (overview ? portLabel(p).width + LABEL_GAP : 0)
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
    // Overview sockets are notches, but each keeps its whole name beside it along the wall.
    const socketLength = (p: Port) => (overview ? Math.max(NOTCH.height, portLabel(p).width) : socketFrame(p).width)
    const pitch = Math.max(36, ...boxes.map((f) => 2 * reach(f.width, f.height, dir)), ...onWall.map(socketLength)) + ROW_GAP
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
      const length = overview ? NOTCH.height : Math.max(socket.width, (lane - start) * pitch - ROW_GAP)
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
  // A hexagon can seat a use case on a wall, in that wall's sector; circles ignore it, as they ignore port walls.
  const seatWall = (u: UseCase): Wall | undefined => (u.placement && u.placement !== 'top' ? u.placement : undefined)
  /** Indices into d.useCases of the use cases stacked under the application title. */
  const stack = d.useCases.flatMap((u, i) => (seatWall(u) ? [] : [i]))
  const stackFrames = stack.map((i) => useCaseFrames[i])
  const useCaseBlock = {
    width: Math.max(0, ...stackFrames.map((f) => f.width)),
    height: stackFrames.reduce((h, f) => h + f.height, 0) + GAP * Math.max(0, stackFrames.length - 1),
  }

  // Use-case buses: one vertical lane per use case and side, between the inner ring and the sockets. The top
  // use case takes the outermost lane so no exit crosses another bus, and the exit run fits the lane's verb.
  const laneVerb: Record<Side, string> = { driving: labels.runs, driven: labels.uses }
  const busX = (side: Side, k: number, innerHalfWidth: number) =>
    // The driven side also keeps one lane per declared port, for the dotted ownership links.
    Math.max(innerHalfWidth + LANE * (1 + (side === 'driven' ? declared.length : 0)), useCaseBlock.width / 2 + measure(laneVerb[side], EDGE_LABEL) + 2 * LANE) +
    LANE * (useCaseFrames.length - 1 - k)
  /** The bus lane's x: the driving lanes run left of the centre, the driven ones right. */
  const laneX = (side: Side, k: number, innerHalfWidth: number) => (side === 'driving' ? -1 : 1) * busX(side, k, innerHalfWidth)
  const socketClearance = (side: Side, innerHalfWidth: number) =>
    useCaseFrames.length && !overview ? busX(side, 0, innerHalfWidth) + RUN : 0
  const useCaseOffsets = stackFrames.map((_, j) => stackFrames.slice(0, j).reduce((o, f) => o + f.height + GAP, 0))

  // A hexagon is no wider at a fixed depth under its vertex however big it grows, so a box too wide for the slope
  // just under the title can only fit lower: the body (never the title) drops until every box clears the slope.
  const bodyShift = (o: Outline) =>
    Math.max(0, ...coreBoxes.map((r) => depthAt(o, Math.abs(r.x) + r.frame.width / 2 + DOMAIN_PAD) - (TITLE_DEPTH + r.top)))
  let domainShift = 0

  /** Where a bus lane turns onto the wall normal that ends on a slanted socket's face. */
  const laneFoot = (face: Point, wall: Wall, lane: number): Point => {
    const { n } = wallFrame(wall)
    return { x: lane, y: face.y - (n.y * (face.x - lane)) / n.x }
  }
  /** The socket's inner face on a slanted wall of a candidate application ring. */
  const faceOf = (b: WallBox, appO: Outline): Point => {
    const { n, dir } = wallFrame(b.wall)
    return { x: n.x * (appO.halfWidth - b.height / 2) + dir.x * b.u, y: n.y * (appO.halfWidth - b.height / 2) + dir.y * b.u }
  }

  /** Centres of the stacked use cases under the application title, in stack order (see placement below). */
  const useCaseCentres = (appO: Outline, insideO: Outline) => {
    const titleBottom = TITLE_DEPTH + titleHeight(appIndex)
    const depth = Math.max(
      titleBottom + GAP,
      ...stackFrames.flatMap((f, j) => [
        depthAt(appO, useCaseBlock.width / 2 + PAD) - useCaseOffsets[j],
        // Bus corners only exist in Detailed, as in the solver: on a circle they would sink the stack into the domain.
        ...(overview ? [] : SIDES.map((s) => depthAt(appO, busX(s, stack[j], insideO.halfWidth) + PAD) - useCaseOffsets[j] - f.height / 2)),
      ]),
    )
    // A run meets an upper slanted wall square, rising as it goes, so its row cannot sit above the lane foot. The
    // feet stay put as the ring grows, so when they lie below the room above the domain no ring can seat the stack
    // under them: the stack then keeps the depth it would have without them, and those runs still double back.
    const belowFeet = overview
      ? -Infinity
      : Math.max(
          -Infinity,
          ...stackFrames.flatMap((f, j) =>
            wallBoxes
              .filter((b) => b.kind === 'port' && wallFrame(b.wall).n.y < 0 && ports.get(b.ref)!.useCaseId === d.useCases[stack[j]].id)
              .map((b) => laneFoot(faceOf(b, appO), b.wall, laneX(b.side, stack[j], insideO.halfWidth)).y + appO.apex - useCaseOffsets[j] - f.height / 2),
          ),
        )
    const lowest = appO.apex - insideO.apex - DOMAIN_RUN - useCaseBlock.height
    let y = -appO.apex + (belowFeet <= lowest ? Math.max(depth, belowFeet) : depth)
    return stackFrames.map((f) => {
      const centre = y + f.height / 2
      y += f.height + GAP
      return centre
    })
  }
  /**
   * A slanted name starts level with its notch's upper end and runs downhill: centred, an upper wall's name would
   * reach toward the top vertex and the application title, and the ring would have to grow to clear it.
   */
  const labelU = (b: WallBox, f: Frame) => b.u + Math.sign(wallFrame(b.wall).dir.y) * (f.width - b.width) / 2
  /** Overview port names for a candidate application ring: flat beside a side-wall socket, along a slanted wall. */
  const portLabels = (appO: Outline) =>
    overview
      ? [
          ...of('port').map((p) => {
            const f = portLabel(ports.get(p.ref)!)
            const sign = p.side === 'driving' ? -1 : 1
            const x = sign * (halfWidthAt(appO, p.y) - widths[p.side].socketHalf - LABEL_GAP - f.width / 2)
            return { ref: p.ref, side: p.side, frame: f, x, y: p.y, rotation: undefined, align: p.side === 'driving' ? ('start' as const) : ('end' as const) }
          }),
          ...wallBoxes
            .filter((b) => b.kind === 'port')
            .map((b) => {
              const f = portLabel(ports.get(b.ref)!)
              const { n, dir } = wallFrame(b.wall)
              const depth = appO.halfWidth - b.height / 2 - LABEL_GAP - f.height / 2
              const u = labelU(b, f)
              return { ref: b.ref, side: b.side, frame: f, x: n.x * depth + dir.x * u, y: n.y * depth + dir.y * u, rotation: wallAngle(b.wall), align: 'center' as const }
            }),
        ]
      : []
  /**
   * Use cases seated on a wall, in wall coordinates: stacked along it like ports, the run centred on the ports they
   * serve on that wall, and set in past the wall's sockets (and their overview names) by the room an arrow needs.
   */
  const seats = () =>
    WALLS.flatMap((wall) => {
      const here = d.useCases.flatMap((u, i) => (seatWall(u) === wall ? [i] : []))
      if (!here.length) return []
      const { n, dir } = wallFrame(wall)
      // The wall's sockets: where each sits along the wall, and how far in it (and its name) reaches.
      const sockets = [
        ...wallBoxes
          .filter((b) => b.kind === 'port' && b.wall === wall)
          .map((b) => ({ port: ports.get(b.ref)!, u: b.u, inward: b.height / 2 + (overview ? LABEL_GAP + portLabel(ports.get(b.ref)!).height : 0) })),
        ...of('port')
          .filter((p) => defaultWall(p.side) === wall)
          .map((p) => ({ port: ports.get(p.ref)!, u: p.y * dir.y, inward: widths[p.side].socketHalf + labelReach(ports.get(p.ref)!) })),
      ]
      const inset = Math.max(0, ...sockets.map((s) => s.inward)) + (overview ? GAP : DOMAIN_RUN)
      const socketsAlong = sockets.map((s) => s.u).sort((a, b) => a - b)
      const items = here
        .map((i) => {
          const f = useCaseFrames[i]
          const own = sockets.find((s) => s.port.useCaseId === d.useCases[i].id)?.u
          const along = reach(f.width, f.height, dir)
          // Another use case's run to a socket on this wall passes through any seat level with that socket, at every
          // ring size, so a seat with no socket of its own here steps past them along the wall.
          let want = own ?? 0
          if (own === undefined) {
            for (const u of socketsAlong) if (Math.abs(u - want) < along + GAP) want = u + along + GAP
          }
          return { i, wall, frame: f, want, along, across: reach(f.width, f.height, n) }
        })
        .sort((a, b) => a.want - b.want)
      let end = -Infinity
      const packed = items.map((it) => {
        const u = Math.max(it.want, end + it.along)
        end = u + it.along + GAP
        return { ...it, u, inset }
      })
      const shift = packed.reduce((t, it) => t + it.want - it.u, 0) / packed.length
      return packed.map((it) => ({ ...it, u: it.u + shift }))
    })
  /** Seated use cases for a candidate application ring, centred in the plane. */
  const seatsAt = (appO: Outline) =>
    seats().map((s) => {
      const { n, dir } = wallFrame(s.wall)
      const depth = appO.halfWidth - s.inset - s.across
      return { ...s, x: n.x * depth + dir.x * s.u, y: n.y * depth + dir.y * s.u }
    })
  const boxQuad = (b: { x: number; y: number; frame: Frame }) => rectCorners(b.x, b.y, b.frame.width, b.frame.height)
  /**
   * From a use case to its bus lane. A stacked one leaves sideways. A seated one may sit beside the domain, so it
   * first steps (vertically) to just past the domain's top or bottom, in the free band under the stack, then across.
   * A port lying past that band picks the band on its own side, so the run never turns back; any other keeps to the
   * use case's side. One already beyond the band crosses at its own row: stepping back to the band would only double back.
   */
  const toLane = (box: { x: number; y: number; width: number; height: number; seated: boolean }, lane: number, insideApex: number, portY: number): Point[] => {
    const toward = Math.sign(lane - box.x)
    if (!box.seated) return [{ x: box.x + (toward * box.width) / 2, y: box.y }, { x: lane, y: box.y }]
    const band = insideApex + LANE
    const clearY = (Math.sign(Math.abs(portY) > band ? portY : box.y) || -1) * band
    const past = Math.sign(box.y) === Math.sign(clearY) && Math.abs(box.y) - box.height / 2 >= band
    const rowY = past ? box.y : clearY
    if (past || Math.abs(clearY - box.y) <= box.height / 2) return [{ x: box.x + (toward * box.width) / 2, y: rowY }, { x: lane, y: rowY }]
    return [{ x: box.x, y: box.y + (Math.sign(clearY - box.y) * box.height) / 2 }, { x: box.x, y: clearY }, { x: lane, y: clearY }]
  }

  /**
   * For a candidate application ring: does a slanted-wall socket, an overview port name or a seated use case touch
   * the stacked use cases or the title (sectors keep each wall's own content apart); or does a use-case run
   * (bus lane, branch or wall-normal run) meet a slanted socket or seated use case it does not serve, or a seated use
   * case's exit cross the stack or the domain? The upper walls lean in exactly where the buses come down from the
   * use cases, so this is what usually sizes the ring once they are used.
   */
  const appClashes = (appO: Outline, insideO: Outline) => {
    const slantedSocket = wallBoxes
      .filter((b) => b.kind === 'port')
      .map((b) => {
        const { n, dir } = wallFrame(b.wall)
        const centre = { x: n.x * appO.halfWidth + dir.x * b.u, y: n.y * appO.halfWidth + dir.y * b.u }
        const face = faceOf(b, appO)
        return { ref: b.ref, side: b.side, wall: b.wall, face, quad: rectCorners(centre.x, centre.y, b.width, b.height, wallAngle(b.wall)) }
      })
    const centres = useCaseCentres(appO, insideO)
    const stacked = stack.map((i, j) => ({ x: 0, y: centres[j], frame: useCaseFrames[i] }))
    const seated = seatsAt(appO)
    const others = [rectCorners(0, -appO.apex + TITLE_DEPTH + titleHeight(appIndex) / 2, titleWidth(appIndex), titleHeight(appIndex)), ...stacked.map(boxQuad)]
    const labels = portLabels(appO).map((l) => rectCorners(l.x, l.y, l.frame.width, l.frame.height, l.rotation))
    const seatQuads = seated.map(boxQuad)
    if ([...slantedSocket.map((s) => s.quad), ...labels, ...seatQuads].some((q) => others.some((o) => quadsOverlap(q, o)))) return true
    if (overview) return false
    // Every use-case run, tagged with the port and use case it serves.
    const runs: { ref: string; useCase: number; quad: Point[] }[] = []
    for (const port of d.ports) {
      const k = d.useCases.findIndex((u) => u.id === port.useCaseId)
      if (k < 0) continue
      const seat = seated.find((s) => s.i === k)
      if (seat && seat.wall === wallOf(port)) continue
      const from = seat ?? stacked[stack.indexOf(k)]
      const sign = port.side === 'driving' ? -1 : 1
      const lane = laneX(port.side, k, insideO.halfWidth)
      const slanted = slantedSocket.find((s) => s.ref === port.id)
      const socket = planned.find((p) => p.key === `port:${port.id}`)
      const portY = slanted?.face.y ?? socket?.y
      if (portY === undefined) continue
      const head = toLane({ x: from.x, y: from.y, width: from.frame.width, height: from.frame.height, seated: !!seat }, lane, insideO.apex, portY)
      head.slice(1).forEach((q, j) => runs.push({ ref: port.id, useCase: k, quad: hairline(head[j], q) }))
      const laneTop = head.at(-1)!.y
      if (slanted) {
        const foot = laneFoot(slanted.face, slanted.wall, lane)
        runs.push({ ref: port.id, useCase: k, quad: hairline({ x: lane, y: laneTop }, foot) }, { ref: port.id, useCase: k, quad: hairline(foot, slanted.face) })
      } else {
        const inner = sign * (appO.halfWidth - widths[port.side].socketHalf)
        runs.push(
          { ref: port.id, useCase: k, quad: hairline({ x: lane, y: laneTop }, { x: lane, y: portY }) },
          { ref: port.id, useCase: k, quad: hairline({ x: lane, y: portY }, { x: inner, y: portY }) },
        )
      }
    }
    if (slantedSocket.some((s) => runs.some((r) => r.ref !== s.ref && quadsOverlap(s.quad, r.quad)))) return true
    const boxes = [...seated.map((s) => ({ i: s.i, quad: boxQuad(s) })), ...stacked.map((b, j) => ({ i: stack[j], quad: boxQuad(b) }))]
    return boxes.some((b) => runs.some((r) => r.useCase !== b.i && quadsOverlap(b.quad, r.quad)))
  }

  // 4. Rings, inside-out: each one holds its own content, fitted to the real box corners. The stack above the
  // inner ring (use cases, then the title) is absolute here; titles move up under the top vertex afterwards.
  const outlines: Outline[] = []
  const appIndex = config.rings.findIndex((r) => r.role === 'application')
  const leafX = (side: Side) => outlines[0].halfWidth + OUTSIDE_GAP + widths[side].leaf / 2

  for (let i = last; i >= 0; i--) {
    const role = config.rings[i].role
    const inner = outlines[i + 1]
    if (role === 'domain') {
      // The block hangs TITLE_DEPTH under the apex, so its corners move with the radius; the width at a fixed
      // depth under the apex only grows with r, which makes the smallest fitting radius a binary search.
      const outline = (r: number) => hexagon(r)
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
        return titleUp && boxes.every((b) => [top + b.from, top + b.to].every((y) => Math.abs(y) <= o.apex + 1e-6 && halfWidthAt(o, y) >= b.x - 1e-6))
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
        const clear = Math.max(halfWidthAt(inner, nearest(p.y, p.height)) + GAP, socketClearance(p.side, inner.halfWidth))
        side.push({ x: clear + widths[p.side].socketHalf + labelReach(ports.get(p.ref)!), y: farthest(p.y, p.height) })
      }
      if (stack.length) {
        const blockTop = inner.apex + (overview ? GAP : DOMAIN_RUN) + useCaseBlock.height
        vertical.push({ x: useCaseBlock.width / 2 + PAD, y: blockTop })
        if (!overview) {
          stackFrames.forEach((f, j) => {
            const centre = blockTop - useCaseOffsets[j] - f.height / 2
            for (const s of SIDES) vertical.push({ x: busX(s, stack[j], inner.halfWidth) + PAD, y: centre })
          })
        }
        stackTop = blockTop
      }
    }
    vertical.push({ x: 0, y: stackTop + GAP + titleHeight(i) + TITLE_DEPTH })
    if (role === 'adapters') {
      for (const p of of('adapter')) {
        const w = widths[p.side]
        side.push({ x: halfWidthAt(inner, p.y) + w.socketHalf + GAP + w.adapter + PAD, y: farthest(p.y, p.height) })
      }
    }
    let minApothem = 0
    if (role === 'application') {
      for (const b of wallBoxes.filter((b) => !b.outer)) for (const c of localCorners(b)) minApothem = Math.max(minApothem, sectorApothem(c.u, c.v))
      for (const b of wallBoxes.filter((b) => b.kind === 'port')) {
        const label = portLabel(ports.get(b.ref)!)
        const labelDepth = overview ? LABEL_GAP + label.height : 0
        minApothem = Math.max(minApothem, inner.halfWidth + GAP + b.height / 2 + labelDepth)
        if (overview) {
          for (const u of [labelU(b, label) - label.width / 2, labelU(b, label) + label.width / 2]) {
            for (const v of [-(b.height / 2 + LABEL_GAP), -(b.height / 2 + labelDepth)]) minApothem = Math.max(minApothem, sectorApothem(u, v))
          }
        }
        const port = d.ports.find((p) => p.id === b.ref)!
        const k = d.useCases.findIndex((u) => u.id === port.useCaseId)
        if (k >= 0 && !overview && seatWall(d.useCases[k]) !== b.wall) {
          // The run from the bus lane to the socket, along the wall normal, keeps at least RUN.
          const { n, dir } = wallFrame(b.wall)
          const bus = laneX(b.side, k, inner.halfWidth)
          minApothem = Math.max(minApothem, (bus + RUN * n.x - b.u * dir.x) / n.x + b.height / 2)
        }
      }
      for (const s of seats()) {
        // Clear of the domain by the room its question needs, and inside its sector like every wall box.
        minApothem = Math.max(minApothem, inner.halfWidth + (overview ? GAP : DOMAIN_RUN) + s.inset + 2 * s.across)
        const { n, dir } = wallFrame(s.wall)
        for (const c of rectCorners(0, 0, s.frame.width, s.frame.height)) {
          minApothem = Math.max(minApothem, sectorApothem(s.u + dot(c, dir), -(s.inset + s.across) + dot(c, n)))
        }
      }
      if (sectored) {
        const socketSpan = (p: Planned) => [-widths[p.side].socketHalf - labelReach(ports.get(p.ref)!), widths[p.side].socketHalf]
        for (const c of columnCorners('port', socketSpan)) minApothem = Math.max(minApothem, sectorApothem(c.u, c.v))
        for (const c of columnCorners('adapter', (p) => [widths[p.side].socketHalf + GAP])) minApothem = Math.max(minApothem, sectorApothem(c.u, c.v))
      }
    }
    if (role === 'adapters') {
      const appApothem = inner.halfWidth
      for (const b of wallBoxes.filter((b) => b.kind === 'adapter')) for (const c of localCorners(b)) minApothem = Math.max(minApothem, appApothem + c.v + PAD)
      for (const b of wallBoxes.filter((b) => b.outer)) for (const c of localCorners(b)) minApothem = Math.max(minApothem, sectorApothem(c.u, c.v))
      if (hasSlanted) for (const c of columnCorners('actor', () => [OUTSIDE_GAP]).concat(columnCorners('external', () => [OUTSIDE_GAP]))) minApothem = Math.max(minApothem, sectorApothem(c.u, c.v))
    }
    let fitted = fitRing(inner, side, vertical, minApothem)
    // Sockets on the upper walls, and overview port names, lean in toward the use cases and the title: grow until
    // none of them touch.
    if (role === 'application' && (hasSlanted || overview || stack.length < d.useCases.length)) {
      for (let guard = 0; guard < 400 && appClashes(fitted, inner); guard++) fitted = hexagon(fitted.apex * 1.01)
    }
    // The title must fit TITLE_DEPTH under the top: the hexagon's slope is wide enough by construction, so only
    // its straight width can bind.
    const w = titleWidth(i) / 2 + LABEL_PAD_X
    outlines[i] = hexagon(Math.max(fitted.apex, w / COS30))
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
    titleBox: { x: -titleWidth(i) / 2, y: -outlines[i].apex + TITLE_DEPTH, width: titleWidth(i), height: titleHeight(i) },
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
  stack.forEach((i, j) => {
    const u = d.useCases[i]
    place(`useCase:${u.id}`, u.id, 'useCase', 'teal', useCaseFrames[i], 0, ucCentres[j]).align = 'center'
  })
  for (const s of seatsAt(app)) {
    const u = d.useCases[s.i]
    Object.assign(place(`useCase:${u.id}`, u.id, 'useCase', 'teal', s.frame, s.x, s.y), { align: 'center', wall: s.wall })
  }

  // Column items of a hexagon sit on the w or e wall when they belong to a port (unassigned ones have no wall).
  const endpointAdapter = new Map([...d.actors, ...d.externals].map((e) => [e.id, e.adapterId]))
  const columnWall = (p: Planned): Wall | undefined => {
    const adapterId = p.kind === 'adapter' ? p.ref : p.kind === 'port' ? undefined : endpointAdapter.get(p.ref)
    const linked = p.kind === 'port' || !!(adapterId && portOf(d.adapters.find((a) => a.id === adapterId)!))
    return linked ? defaultWall(p.side) : undefined
  }
  for (const p of planned) {
    const sign = p.side === 'driving' ? -1 : 1
    const w = widths[p.side]
    const edge = halfWidthAt(app, p.y)
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
  for (const l of portLabels(app)) {
    add({ key: `portLabel:${l.ref}`, ref: l.ref, kind: 'portLabel', tone: 'teal', lines: l.frame.lines, align: l.align, side: l.side, rotation: l.rotation, x: l.x, y: l.y, width: l.frame.width, height: l.frame.height })
  }

  if (d.composition && !overview) {
    const f = frame([...styled('mono', d.composition.name), ...noteLines(d.composition.note)], 120)
    place('composition', 'composition', 'composition', 'muted', f, 0, outer.apex + GAP + f.height / 2).align = 'center'
  }

  const edges = routeEdges({ d, overview, nodes, edgePlan, app, insideApp, domain, outer, seating: { stack, blockWidth: useCaseBlock.width, laneX, toLane, laneFoot } })

  const { texts, bounds } = layoutBounds(d, outer, nodes, edges)

  // Layer membership: use cases in application, ports and adapters in the adapter ring, the domain block in the
  // domain (onion's services in their own ring), endpoints only where they sit inside the outermost ring.
  const serviceIds = new Set(serviceItems.map((i) => i.id))
  const layerOf = (n: LayoutNode): RingRole | undefined => {
    if (n.kind === 'useCase') return 'application'
    if (n.kind === 'port' || n.kind === 'portLabel' || n.kind === 'adapter') return 'adapters'
    if (n.kind === 'actor' || n.kind === 'external') return undefined
    if (n.kind === 'composition') return undefined
    return serviceIds.has(n.ref) ? 'domainServices' : 'domain'
  }
  for (const n of nodes) n.layer = layerOf(n)

  // Spokes run along the centre-to-vertex lines, from each outer vertex in to the domain's, never over its fill.
  const guides = VERTEX.map((v) => ({ from: { x: v.x * outer.apex, y: v.y * outer.apex }, to: { x: v.x * domain.apex, y: v.y * domain.apex } }))

  return {
    shape: 'hexagon',
    rings,
    guides,
    nodes,
    edges,
    texts,
    bounds,
  }
}
