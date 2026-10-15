import type { RingRole } from '../../model/kinds'
import type { Diagram } from '../../model/schema'
import type { LayoutNode } from '../layout'
import { GAP } from './spacing'
import type { CentreBlock } from './centreBlock'
import type { Frame, BoxFrames } from './boxFrames'
import type { Element } from './elements'
import { onWall } from './corridors'

export interface NodesInput {
  d: Diagram
  elements: Element[]
  /** The wall apothem of each layer, innermost first. */
  radii: number[]
  /** The apex of the outermost hexagon, which the composition root hangs under. */
  outerApex: number
  centre: CentreBlock
  frames: BoxFrames
}

/** Every node of the diagram at its final position, in draw order: the domain model, then the boxes on the walls; `composition` is the root, absent when none is drawn. */
export function placeNodes({ d, elements, radii, outerApex, centre, frames }: NodesInput): { nodes: LayoutNode[]; composition: LayoutNode | undefined } {
  const nodes: LayoutNode[] = []
  const place = (key: string, ref: string, kind: LayoutNode['kind'], tone: LayoutNode['tone'], f: Frame, x: number, y: number) => {
    const node: LayoutNode = { key, ref, kind, tone, lines: f.lines, x, y, width: f.width, height: f.height }
    nodes.push(node)
    return node
  }

  // Outlines first so they draw under the lines they enclose.
  for (const r of centre.boxes) {
    const node = place(r.key, r.ref, r.kind, 'domain', r.frame, r.x, r.y)
    if (r.kind !== 'aggregate') node.align = 'center'
    else node.wall = centre.faces.get(r.ref)
  }
  for (const e of elements) {
    const { x, y } = onWall(e.wall, radii[e.layer], e.u)
    Object.assign(place(e.key, e.ref, e.kind, e.tone, e.frame, x, y), { align: 'center', wall: e.wall, ...(e.side ? { side: e.side } : {}) })
  }
  const frame = d.composition ? frames.compositionFrame(d.composition) : undefined
  const composition = frame ? Object.assign(place('composition', 'composition', 'composition', 'muted', frame, 0, outerApex + GAP + frame.height / 2), { align: 'center' as const }) : undefined
  return { nodes, composition }
}

// Layer membership: use cases in application, ports and adapters in the adapter ring, the domain block in the
// domain, endpoints only where they sit inside the outermost ring.
export function assignLayers(nodes: LayoutNode[]) {
  const layerOf = (n: LayoutNode): RingRole | undefined => {
    if (n.kind === 'useCase') return 'application'
    if (n.kind === 'port' || n.kind === 'adapter') return 'adapters'
    if (n.kind === 'actor' || n.kind === 'external' || n.kind === 'composition') return undefined
    return 'domain'
  }
  for (const n of nodes) n.layer = layerOf(n)
}

