import { HEXAGONAL_KIND, type RingRole } from '../model/kinds'
import type { CollectionKey, Diagram, DomainType, Side, Wall } from '../model/schema'
import { wallFrame, type LayoutModel, type LayoutNode, type Point } from './layout'

/** What a "+" creates, and what the new element is linked to. The position of the "+" decides both. */
export type InsertionAction =
  | { kind: 'domainRoot' }
  | { kind: 'domainChild'; parentId: string }
  | { kind: 'drivenPortDecl' }
  | { kind: 'useCase'; placement?: Wall }
  | { kind: 'port'; side: Side; wall?: Wall }
  | { kind: 'adapter'; side: Side; portId?: string }
  | { kind: 'endpoint'; side: Side; adapterId: string }

export interface InsertionPoint {
  key: string
  /** The layer whose hover or focus reveals this "+". */
  layer: RingRole
  at: Point
  action: InsertionAction
  label: string
}

/** The domain types a domain "+" offers; the first is the default. */
export const DOMAIN_CHOICES: Record<'domainRoot' | 'domainChild', DomainType[]> = {
  domainRoot: ['aggregate', 'entity'],
  domainChild: ['entity', 'valueObject'],
}

const WALL_NAME: Record<Wall, string> = { nw: 'north-west', w: 'west', sw: 'south-west', ne: 'north-east', e: 'east', se: 'south-east' }
const WALLS: Wall[] = ['nw', 'w', 'sw', 'ne', 'e', 'se']
const GAP = 16
const NEAR = 28
/** A "+" is drawn 24 across; nothing else may sit under it, and it keeps 8 more from a spoke. */
const PLUS = 24
const SPOKE_ROOM = PLUS / 2 + 8
const COS30 = Math.sqrt(3) / 2

const bottom = (n: LayoutNode) => n.y + n.height / 2
const lowest = (nodes: LayoutNode[]) => nodes.reduce((a, b) => (bottom(b) > bottom(a) ? b : a))
const sideNormal = (side: Side) => ({ x: side === 'driving' ? -1 : 1, y: 0 })
/** A node's outward normal: its wall's, or its side's for circles and the w/e columns. */
const normalOf = (n: LayoutNode) => (n.wall ? wallFrame(n.wall).n : sideNormal(n.side ?? 'driving'))
/** Half an upright or wall-rotated box's reach along a unit vector. */
const halfReach = (n: LayoutNode, v: Point) =>
  n.rotation !== undefined
    ? n.height / 2
    : (n.width / 2) * Math.abs(v.x) + (n.height / 2) * Math.abs(v.y)

export function insertionPoints(model: LayoutModel, d: Diagram, mode: 'detailed' | 'overview'): InsertionPoint[] {
  const config = HEXAGONAL_KIND
  const app = model.rings.find((r) => r.role === 'application')!
  const domainRing = model.rings[model.rings.length - 1]
  const outermost = model.rings[0].role
  const points: InsertionPoint[] = []
  const nodesOf = (kind: LayoutNode['kind']) => model.nodes.filter((n) => n.kind === kind)
  const name = (id: string, list: { id: string; name: string }[]) => list.find((x) => x.id === id)?.name ?? ''

  // Domain: under the last root, on each aggregate outline, under the declared ports.
  const tree = model.nodes.filter((n) => (n.kind === 'domainItem' || n.kind === 'aggregate') && n.layer === 'domain')
  const underTree = tree.length ? lowest(tree) : undefined
  points.push({
    key: 'domain:root',
    layer: 'domain',
    // Under an aggregate outline, the child "+" already rides the outline's edge: the root "+" drops one "+" further.
    at: underTree
      ? { x: underTree.x, y: bottom(underTree) + GAP + (underTree.kind === 'aggregate' ? PLUS : 0) }
      : { x: 0, y: domainRing.titleBox.y + domainRing.titleBox.height + GAP },
    action: { kind: 'domainRoot' },
    label: 'Add a domain item',
  })
  for (const outline of nodesOf('aggregate')) {
    points.push({
      key: `domain:child:${outline.ref}`,
      layer: 'domain',
      at: { x: outline.x, y: bottom(outline) },
      action: { kind: 'domainChild', parentId: outline.ref },
      label: `Add an item inside ${name(outline.ref, d.domain)}`,
    })
  }
  const portList = model.nodes.filter((n) => n.kind === 'note' || n.kind === 'portDecl')
  if (mode === 'detailed' && config.drivenPortNote && portList.length) {
    const last = lowest(portList)
    points.push({ key: 'domain:port', layer: 'domain', at: { x: last.x, y: bottom(last) + GAP }, action: { kind: 'drivenPortDecl' }, label: 'Add a driven port' })
  }

  // Application: one "+" under the stacked use cases (under the title block when there are none), one per sector,
  // and one past the end of each wall's port run (the midpoint when empty).
  const stacked = nodesOf('useCase').filter((u) => !u.wall)
  const stackPlus = stacked.length ? { x: 0, y: bottom(lowest(stacked)) + GAP } : { x: 0, y: app.titleBox.y + app.titleBox.height + GAP }
  points.push({ key: 'application:useCase', layer: 'application', at: stackPlus, action: { kind: 'useCase' }, label: 'Add a use case' })
  // The stack's column, title to "+": another "+" there would cover the title or repeat the stack's own.
  const stackWidth = Math.max(app.titleBox.width, ...stacked.map((u) => u.width))
  const stackArea = { x: -stackWidth / 2, y: app.titleBox.y, width: stackWidth, height: stackPlus.y - app.titleBox.y }
  const covers = (b: { x: number; y: number; width: number; height: number }, q: Point) =>
    q.x + PLUS / 2 > b.x && q.x - PLUS / 2 < b.x + b.width && q.y + PLUS / 2 > b.y && q.y - PLUS / 2 < b.y + b.height
  const free = (q: Point) => !covers(stackArea, q) && !model.rings.some((r) => covers(r.titleBox, q))
  {
    const inner = model.rings[model.rings.indexOf(app) + 1]
    for (const wall of WALLS) {
      const { n, dir } = wallFrame(wall)
      const seated = nodesOf('useCase').filter((u) => u.wall === wall)
      const depth = seated.length ? seated[0].x * n.x + seated[0].y * n.y : (app.halfWidth + inner.halfWidth) / 2
      // Along the wall at this depth, a "+" keeps SPOKE_ROOM from both spokes of its sector.
      const limit = Math.max(0, depth / Math.sqrt(3) - SPOKE_ROOM / COS30)
      const us = seated.map((u) => u.x * dir.x + u.y * dir.y)
      const ends = seated.length
        ? [Math.max(...seated.map((u, k) => us[k] + halfReach(u, dir))) + GAP + PLUS / 2, Math.min(...seated.map((u, k) => us[k] - halfReach(u, dir))) - GAP - PLUS / 2]
        : [0]
      // The free end away from the top and bottom vertices first, where the stack and the title are.
      const at = ends
        .map((u) => Math.min(Math.max(u, -limit), limit))
        .map((u) => ({ x: n.x * depth + dir.x * u, y: n.y * depth + dir.y * u }))
        .sort((a, b) => Math.abs(b.x) - Math.abs(a.x))
        .find(
          (q) =>
            free(q) &&
            // The upper sectors share their height with the stack; up there the stack's own "+" is the one to use.
            !((wall === 'nw' || wall === 'ne') && q.y < stackPlus.y + PLUS) &&
            !seated.some((u) => covers({ x: u.x - u.width / 2, y: u.y - u.height / 2, width: u.width, height: u.height }, q)),
        )
      if (!at) continue
      points.push({ key: `application:useCase:${wall}`, layer: 'application', at, action: { kind: 'useCase', placement: wall }, label: `Add a use case on the ${WALL_NAME[wall]} wall` })
    }
  }
  const sockets = nodesOf('port')
  for (const wall of WALLS) {
    const side: Side = ['nw', 'w', 'sw'].includes(wall) ? 'driving' : 'driven'
    const { n, dir } = wallFrame(wall)
    // An overview port name can run past its notch along the wall; the "+" goes past both.
    const onWall = [...sockets.filter((s) => s.wall === wall), ...nodesOf('portLabel').filter((l) => sockets.some((s) => s.ref === l.ref && s.wall === wall))]
    const along = onWall.length ? Math.max(...onWall.map((s) => s.x * dir.x + s.y * dir.y + (s.rotation !== undefined ? s.width : s.height) / 2)) + GAP : 0
    // Where the title or the stack is in the way, slide down the wall, away from the vertical axis, within the wall.
    const away = Math.sign(dir.x * n.x) || 1
    const at = Array.from({ length: Math.ceil(app.apex / PLUS) + 1 }, (_, k) => along + away * k * (PLUS / 2))
      .filter((u) => Math.abs(u) <= app.apex / 2)
      .map((u) => ({ x: n.x * app.halfWidth + dir.x * u, y: n.y * app.halfWidth + dir.y * u }))
      .find(free)
    if (!at) continue
    points.push({ key: `application:port:${wall}`, layer: 'application', at, action: { kind: 'port', side, wall }, label: `Add a ${side} port on the ${WALL_NAME[wall]} wall` })
  }

  // Adapter ring: beside each port with no adapter, then at the end of each side column.
  const adapters = nodesOf('adapter')
  for (const socket of sockets.filter((s) => !d.adapters.some((a) => a.portId === s.ref))) {
    const n = normalOf(socket)
    const reach = halfReach(socket, n) + NEAR
    points.push({
      key: `adapters:for:${socket.ref}`,
      layer: 'adapters',
      at: { x: socket.x + n.x * reach, y: socket.y + n.y * reach },
      action: { kind: 'adapter', side: socket.side!, portId: socket.ref },
      label: `Add an adapter for ${name(socket.ref, d.ports)}`,
    })
  }
  for (const side of ['driving', 'driven'] as const) {
    const column = adapters.filter((a) => a.side === side && (!a.wall || a.wall === 'w' || a.wall === 'e'))
    const sign = side === 'driving' ? -1 : 1
    const last = column.length ? lowest(column) : undefined
    points.push({
      key: `adapters:column:${side}`,
      layer: 'adapters',
      at: last ? { x: last.x, y: bottom(last) + GAP } : { x: sign * (app.halfWidth + 60), y: 0 },
      action: { kind: 'adapter', side },
      label: `Add a ${side} adapter`,
    })
  }

  // Outermost layer: beside each adapter with no actor (driving) or external (driven), out along its normal.
  for (const adapter of adapters) {
    const endpoints = adapter.side === 'driving' ? d.actors : d.externals
    if (endpoints.some((e) => e.adapterId === adapter.ref)) continue
    const n = normalOf(adapter)
    const reach = halfReach(adapter, n) + NEAR
    points.push({
      key: `${outermost}:for:${adapter.ref}`,
      layer: outermost,
      at: { x: adapter.x + n.x * reach, y: adapter.y + n.y * reach },
      action: { kind: 'endpoint', side: adapter.side!, adapterId: adapter.ref },
      label: `Add ${adapter.side === 'driving' ? 'an actor' : 'an external system'} for ${name(adapter.ref, d.adapters)}`,
    })
  }
  // Last guard: two "+" closer than one "+" across would cover each other; the one offered first wins.
  return points.reduce<InsertionPoint[]>((kept, p) => (kept.every((q) => Math.hypot(q.at.x - p.at.x, q.at.y - p.at.y) >= PLUS) ? [...kept, p] : kept), [])
}

const DOMAIN_NAME: Record<DomainType, string> = {
  aggregate: 'NewAggregate',
  entity: 'NewEntity',
  valueObject: 'NewValueObject',
  domainService: 'NewDomainService',
}

/** The store call behind a "+": which collection, and the patch carrying its default name and links. */
export function insertionItem(action: InsertionAction, choice?: DomainType): { collection: CollectionKey; patch: Record<string, string> } {
  // Driving ports read as commands (camelCase), driven ports as interfaces (PascalCase).
  const portName = (side: Side) => (side === 'driving' ? 'newPort' : 'NewPort')
  switch (action.kind) {
    case 'domainRoot':
    case 'domainChild': {
      const type = choice ?? DOMAIN_CHOICES[action.kind][0]
      return { collection: 'domain', patch: { name: DOMAIN_NAME[type], type, ...(action.kind === 'domainChild' ? { parentId: action.parentId } : {}) } }
    }
    case 'drivenPortDecl':
      return { collection: 'ports', patch: { name: portName('driven'), side: 'driven', wall: 'e' } }
    case 'useCase':
      return { collection: 'useCases', patch: { name: 'NewUseCase', ...(action.placement ? { placement: action.placement } : {}) } }
    case 'port':
      return { collection: 'ports', patch: { name: portName(action.side), side: action.side, ...(action.wall ? { wall: action.wall } : {}) } }
    case 'adapter':
      return { collection: 'adapters', patch: { name: 'NewAdapter', ...(action.portId ? { portId: action.portId } : {}) } }
    case 'endpoint':
      return action.side === 'driving'
        ? { collection: 'actors', patch: { name: 'New actor', adapterId: action.adapterId } }
        : { collection: 'externals', patch: { name: 'New system', adapterId: action.adapterId } }
  }
}
