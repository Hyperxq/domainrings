import { KINDS, type RingRole } from '../model/kinds'
import type { CollectionKey, Diagram, DomainType, Side, Wall } from '../model/schema'
import { wallFrame, type LayoutModel, type LayoutNode, type Point } from './layout'

/** What a "+" creates, and what the new element is linked to. The position of the "+" decides both. */
export type InsertionAction =
  | { kind: 'domainRoot' }
  | { kind: 'domainChild'; parentId: string }
  | { kind: 'drivenPortDecl' }
  | { kind: 'useCase' }
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
  const config = KINDS[d.kind]
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
    at: underTree ? { x: underTree.x, y: bottom(underTree) + GAP } : { x: 0, y: domainRing.labelAt.y + 36 },
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

  // Application: under the last use case, and past the end of each wall's port run (the midpoint when empty).
  const useCases = nodesOf('useCase')
  points.push({
    key: 'application:useCase',
    layer: 'application',
    at: useCases.length ? { x: 0, y: bottom(lowest(useCases)) + GAP } : { x: 0, y: app.labelAt.y + 36 },
    action: { kind: 'useCase' },
    label: 'Add a use case',
  })
  const sockets = nodesOf('port')
  if (model.shape === 'hexagon') {
    for (const wall of WALLS) {
      const side: Side = ['nw', 'w', 'sw'].includes(wall) ? 'driving' : 'driven'
      const { n, dir } = wallFrame(wall)
      // An overview port name can run past its notch along the wall; the "+" goes past both.
      const onWall = [...sockets.filter((s) => s.wall === wall), ...nodesOf('portLabel').filter((l) => sockets.some((s) => s.ref === l.ref && s.wall === wall))]
      const along = onWall.length ? Math.max(...onWall.map((s) => s.x * dir.x + s.y * dir.y + (s.rotation !== undefined ? s.width : s.height) / 2)) + GAP : 0
      points.push({
        key: `application:port:${wall}`,
        layer: 'application',
        at: { x: n.x * app.halfWidth + dir.x * along, y: n.y * app.halfWidth + dir.y * along },
        action: { kind: 'port', side, wall },
        label: `Add a ${side} port on the ${WALL_NAME[wall]} wall`,
      })
    }
  } else {
    for (const side of ['driving', 'driven'] as const) {
      const onSide = sockets.filter((s) => s.side === side)
      const sign = side === 'driving' ? -1 : 1
      const last = onSide.length ? lowest(onSide) : undefined
      points.push({
        key: `application:port:${side}`,
        layer: 'application',
        at: last ? { x: last.x, y: bottom(last) + GAP } : { x: sign * app.halfWidth, y: 0 },
        action: { kind: 'port', side },
        label: `Add a ${side} port`,
      })
    }
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
  return points
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
      return { collection: 'useCases', patch: { name: 'NewUseCase' } }
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
