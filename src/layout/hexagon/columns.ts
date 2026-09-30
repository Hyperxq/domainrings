import { HEXAGONAL_KIND } from '../../model/kinds'
import { defaultWall, SideSchema, type Adapter, type Diagram, type Endpoint, type Port, type Side, type Wall } from '../../model/schema'
import { dot, reach, rectCorners } from '../geometry'
import type { NodeKind } from '../layout'
import { halfWidthAt, type Outline } from '../outline'
import type { BoxFrames, Frame } from './boxFrames'
import { GAP, LABEL_GAP, OUTSIDE_GAP } from './spacing'
import { SLANTED_WALLS, wallAngle, wallFrame } from './walls'

const ROW_GAP = 18


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

/** Where every box outside the rings sits: rows in the w/e columns, lanes along the slanted walls, and the overview port names beside their sockets. */
export function planBoxes(d: Diagram, overview: boolean, { NOTCH, portLabel, adapterFrame, socketFrame, leafFrame }: BoxFrames) {
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

  // Rows: a uniform pitch fitted to the tallest single-row box, centred on the ring centre.
  const pending = SideSchema.options.flatMap((side) => {
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
    SideSchema.options.map((s) => [s, { socketHalf: widest(s, 'port:') / 2, adapter: widest(s, 'adapter:'), leaf: widest(s, 'leaf:') }]),
  ) as Record<Side, { socketHalf: number; adapter: number; leaf: number }>

  const planned: Planned[] = []
  const edgePlan: Array<[string, string, string?]> = []
  for (const side of SideSchema.options) {
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

  // Slanted walls: the same port → adapter → endpoint groups, laid in lanes along the wall (u) and stepped out
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
  return { ports, portOf, wallOf, hasSlanted, sectored, planned, of, edgePlan, widths, wallBoxes, localCorners, columnCorners, labelU, portLabels }
}
