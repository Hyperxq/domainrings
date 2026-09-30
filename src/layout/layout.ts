import { HEXAGONAL_KIND, type RingRole } from '../model/kinds'
import { defaultWall, type Adapter, type Diagram, type DomainItem, type Endpoint, type Port, type Side, type Wall } from '../model/schema'
import { dot, reach, rectCorners, type Box, type Point } from './geometry'
import { boxFrames, frame, type Frame } from './hexagon/boxFrames'
import { layoutBounds } from './hexagon/bounds'
import { assignLayers, placeNodes } from './hexagon/nodes'
import { solveRings } from './hexagon/ringSolver'
import { ringTitles } from './hexagon/ringTitles'
import { routeEdges } from './hexagon/routes'
import { COLUMN_GAP, DOMAIN_PAD, GAP, LABEL_GAP, OUTSIDE_GAP } from './hexagon/spacing'
import { seatUseCases } from './hexagon/useCaseSeating'
import { SLANTED_WALLS, VERTEX, wallAngle, wallFrame } from './hexagon/walls'
import { depthAt, halfWidthAt, type Outline } from './outline'
import { DOMAIN_TAGS } from './tags'
import { styled, type TextLine } from './text'

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

const ROW_GAP = 18
/** Past these rendered line counts the domain tree, then the declared-port list, flow into two columns. */
const DOMAIN_MAX_LINES = 8
const PORTS_MAX_LINES = 4
/** An aggregate outline: 8 padding all round, plus its tag line above the root. */
const OUTLINE_PAD = 8
const BLOCK_GAP = 6


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
export interface Planned {
  key: string
  ref: string
  kind: NodeKind
  side: Side
  y: number
  frame: Frame
  height: number
}

/** A box on a slanted wall: u runs along the wall, v steps out along its normal. */
export interface WallBox {
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

  const frames = boxFrames(overview)
  const { NOTCH, portLabel, labelReach, adapterFrame, socketFrame, leafFrame, domainFrame, useCaseFrame } = frames

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

  const titles = ringTitles(d)
  const { titleWidth, titleHeight, titleDepth: TITLE_DEPTH } = titles
  const last = config.rings.length - 1

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
  const useCaseFrames = d.useCases.map(useCaseFrame)
  const appIndex = config.rings.findIndex((r) => r.role === 'application')
  const seating = seatUseCases({
    d,
    overview,
    appIndex,
    useCaseFrames,
    declaredPorts: declared.length,
    titles: { titleHeight, titleDepth: TITLE_DEPTH },
    columns: { ports, wallBoxes, of, widths },
    frames: { portLabel, labelReach },
  })
  const { stack, useCaseBlock, useCaseCentres, seatsAt } = seating

  // A hexagon is no wider at a fixed depth under its vertex however big it grows, so a box too wide for the slope
  // just under the title can only fit lower: the body (never the title) drops until every box clears the slope.
  const bodyShift = (o: Outline) =>
    Math.max(0, ...coreBoxes.map((r) => depthAt(o, Math.abs(r.x) + r.frame.width / 2 + DOMAIN_PAD) - (TITLE_DEPTH + r.top)))

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
  const { outlines, domainShift } = solveRings({
    d,
    overview,
    appIndex,
    titles: { titleWidth, titleHeight, titleDepth: TITLE_DEPTH },
    centre: { boxes: coreBoxes, serviceFrames, servicesBlock, bodyShift },
    columns: { ports, wallOf, planned, of, widths, wallBoxes, hasSlanted, sectored, localCorners, columnCorners },
    frames: { portLabel, labelReach },
    seating: { ...seating, useCaseFrames, labelU, portLabels },
  })

  const app = outlines[appIndex]
  const insideApp = outlines[appIndex + 1]
  const outer = outlines[0]
  const domain = outlines[last]

  // 5. Nodes and edges.
  const rings = titles.rings(outlines)

  const compositionFrame = d.composition && !overview ? frames.compositionFrame(d.composition) : undefined
  const nodes = placeNodes({
    d,
    app,
    outer,
    domain,
    titleDepth: TITLE_DEPTH,
    domainShift,
    centre: { boxes: coreBoxes, serviceItems, serviceFrames, servicesHeight: servicesBlock.height },
    columns: { planned, widths, portOf },
    wallBoxes,
    useCases: { stack, frames: useCaseFrames, stackCentres: useCaseCentres(app, insideApp), seated: seatsAt(app) },
    portLabels: portLabels(app),
    compositionFrame,
  })

  const edges = routeEdges({ d, overview, nodes, edgePlan, app, insideApp, domain, outer, seating: { stack, blockWidth: useCaseBlock.width, laneX: seating.laneX } })

  const { texts, bounds } = layoutBounds(d, outer, nodes, edges)

  assignLayers(nodes, serviceItems)

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
