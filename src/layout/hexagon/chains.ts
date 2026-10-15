import { defaultWall, DRIVING_WALLS, type Adapter, type Diagram, type Endpoint, type Port, type Side, type Wall } from '../../model/schema'
import { reach } from '../geometry'
import type { Frame } from './boxFrames'
import { GAP } from './spacing'
import { WALLS, wallFrame } from './walls'

export interface ChainFrames {
  port: (p: Port) => Frame
  adapter: (a: Adapter, side: Side) => Frame
  leaf: (e: Endpoint, side: Side) => Frame
}

/** Where a port, adapter, actor or external sits: its wall and its place along it (0 is the middle of the wall). */
export interface ChainSlot {
  key: string
  ref: string
  kind: 'port' | 'adapter' | 'actor' | 'external'
  side: Side
  wall: Wall
  u: number
}

/** A port, an adapter or an endpoint with what hangs off it, measured along the wall it will sit on. */
interface Link {
  key: string
  ref: string
  kind: ChainSlot['kind']
  side: Side
  frame: Frame
  children: Link[]
}

const SIDE_WALLS: Record<Side, Wall[]> = {
  driving: WALLS.filter((w) => DRIVING_WALLS.has(w)),
  driven: WALLS.filter((w) => !DRIVING_WALLS.has(w)),
}

/**
 * The wall and place along it of every port, adapter, actor and external. A port sits on its own wall (its side's
 * default without one) and its adapters and their endpoints line up radially with it, several adapters spread evenly
 * around the port. An adapter or endpoint no port reaches takes the least crowded wall of its side. Each wall packs its
 * chains in model order, centred on the wall, every box as far from the next as the widest box of its chain needs.
 */
export function planChains(d: Diagram, frames: ChainFrames): ChainSlot[] {
  const leaves = (side: Side) => (side === 'driving' ? d.actors : d.externals)
  const leafKind = (side: Side) => (side === 'driving' ? 'actor' : 'external')
  const leaf = (e: Endpoint, side: Side): Link => ({ key: `${leafKind(side)}:${e.id}`, ref: e.id, kind: leafKind(side), side, frame: frames.leaf(e, side), children: [] })
  const adapterLink = (a: Adapter, side: Side): Link => ({
    key: `adapter:${a.id}`,
    ref: a.id,
    kind: 'adapter',
    side,
    frame: frames.adapter(a, side),
    children: leaves(side).filter((e) => e.adapterId === a.id).map((e) => leaf(e, side)),
  })

  const chains: Array<{ wall: Wall; root: Link }> = d.ports.map((p) => ({
    wall: p.wall ?? defaultWall(p.side),
    root: { key: `port:${p.id}`, ref: p.id, kind: 'port', side: p.side, frame: frames.port(p), children: d.adapters.filter((a) => a.portId === p.id).map((a) => adapterLink(a, p.side)) },
  }))

  const portIds = new Set(d.ports.map((p) => p.id))
  const orphanAdapters = d.adapters.filter((a) => !a.portId || !portIds.has(a.portId))
  const sideOf = (a: Adapter): Side => (d.externals.some((e) => e.adapterId === a.id) && !d.actors.some((e) => e.adapterId === a.id) ? 'driven' : 'driving')
  // An endpoint belongs to an adapter of its own side only: an actor on a driven adapter has no chain either.
  const adapterSide = new Map<string, Side>([...d.adapters.filter((a) => a.portId && portIds.has(a.portId)).map((a) => [a.id, d.ports.find((p) => p.id === a.portId)!.side] as const), ...orphanAdapters.map((a) => [a.id, sideOf(a)] as const)])
  const loose = (side: Side) => leaves(side).filter((e) => !e.adapterId || adapterSide.get(e.adapterId) !== side)
  const orphans: Link[] = [...orphanAdapters.map((a) => adapterLink(a, sideOf(a))), ...loose('driving').map((e) => leaf(e, 'driving')), ...loose('driven').map((e) => leaf(e, 'driven'))]

  /** The children of a link take equal slots, so they spread symmetrically about it. */
  const slot = (link: Link, wall: Wall) => Math.max(0, ...link.children.map((c) => span(c, wall)))
  const kids = (link: Link, wall: Wall) => (link.children.length ? link.children.length * slot(link, wall) + (link.children.length - 1) * GAP : 0)
  const span = (link: Link, wall: Wall): number => {
    const { dir } = wallFrame(wall)
    return Math.max(2 * reach(link.frame.width, link.frame.height, dir), kids(link, wall))
  }
  const crowd = (wall: Wall) => chains.filter((c) => c.wall === wall).reduce((sum, c) => sum + span(c.root, wall) + GAP, 0)
  for (const root of orphans) {
    const wall = SIDE_WALLS[root.side].reduce((best, w) => (crowd(w) < crowd(best) ? w : best))
    chains.push({ wall, root })
  }

  const slots: ChainSlot[] = []
  const lay = (link: Link, wall: Wall, u: number) => {
    slots.push({ key: link.key, ref: link.ref, kind: link.kind, side: link.side, wall, u })
    const width = slot(link, wall)
    link.children.forEach((child, i) => lay(child, wall, u - kids(link, wall) / 2 + width / 2 + i * (width + GAP)))
  }
  for (const wall of WALLS) {
    const here = chains.filter((c) => c.wall === wall)
    let start = -here.reduce((sum, c, i) => sum + span(c.root, wall) + (i ? GAP : 0), 0) / 2
    for (const { root } of here) {
      const width = span(root, wall)
      lay(root, wall, start + width / 2)
      start += width + GAP
    }
  }
  return slots
}
