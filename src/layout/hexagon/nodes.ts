import type { RingRole } from '../../model/kinds'
import { defaultWall, type Diagram, type DomainItem, type Side, type Wall } from '../../model/schema'
import type { LayoutNode, NodeKind, Tone } from '../layout'
import { halfWidthAt, type Outline } from '../outline'
import type { BoxFrames, Frame } from './boxFrames'
import type { CentreBlock } from './centreBlock'
import type { BoxPlan, Planned } from './columns'
import type { RingTitles } from './ringTitles'
import { GAP, OUTSIDE_GAP } from './spacing'
import type { UseCaseSeating } from './useCaseSeating'
import { wallAngle, wallFrame } from './walls'

export interface NodesInput {
  d: Diagram
  overview: boolean
  app: Outline
  insideApp: Outline
  outer: Outline
  domain: Outline
  titles: RingTitles
  /** How far the domain body sits below its title (see the ring solver). */
  domainShift: number
  centre: CentreBlock
  plan: BoxPlan
  frames: BoxFrames
  useCaseFrames: Frame[]
  seating: UseCaseSeating
}

/** Every node of the diagram at its final position, in draw order: domain block, use cases, column boxes, wall boxes, overview port names, composition root. */
export function placeNodes({ d, overview, app, insideApp, outer, domain, titles, domainShift, centre, plan, frames, useCaseFrames, seating }: NodesInput): LayoutNode[] {
  const { titleDepth } = titles
  const { planned, widths, portOf, wallBoxes } = plan
  const { stack } = seating
  const useCaseCentres = seating.useCaseCentres(app, insideApp)
  const seats = seating.seatsAt(app)
  const compositionFrame = d.composition && !overview ? frames.compositionFrame(d.composition) : undefined
  const nodes: LayoutNode[] = []
  const add = (n: LayoutNode) => (nodes.push(n), n)
  const place = (key: string, ref: string, kind: NodeKind, tone: Tone, f: Frame, x: number, y: number, side?: Side) =>
    add({ key, ref, kind, tone, lines: f.lines, side, x, y, width: f.width, height: f.height })
  const leafX = (side: Side) => outer.halfWidth + OUTSIDE_GAP + widths[side].leaf / 2

  const blockTop = -domain.apex + titleDepth
  // Outlines first so they draw under the lines they enclose.
  for (const r of centre.boxes) {
    const node = place(r.key, r.ref, r.kind, 'domain', r.frame, r.x, blockTop + domainShift + r.top + r.frame.height / 2)
    if (r.kind !== 'aggregate') node.align = 'center'
  }
  let y = 0
  y = -(domain.apex + GAP + centre.servicesBlock.height)
  centre.serviceItems.forEach((item, i) => {
    const f = centre.serviceFrames[i]
    place(`domainItem:${item.id}`, item.id, 'domainItem', 'domain', f, 0, y + f.height / 2)
    y += f.height
  })
  // Use cases hang right under the application title, lowered only where the ring is too narrow for a box or
  // for its bus corners; the solver guaranteed the stacked position fits, so this never goes below it.
  stack.forEach((i, j) => {
    const u = d.useCases[i]
    place(`useCase:${u.id}`, u.id, 'useCase', 'teal', useCaseFrames[i], 0, useCaseCentres[j]).align = 'center'
  })
  for (const s of seats) {
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
  for (const l of plan.portLabels(app)) {
    add({ key: `portLabel:${l.ref}`, ref: l.ref, kind: 'portLabel', tone: 'teal', lines: l.frame.lines, align: l.align, side: l.side, rotation: l.rotation, x: l.x, y: l.y, width: l.frame.width, height: l.frame.height })
  }

  if (compositionFrame) place('composition', 'composition', 'composition', 'muted', compositionFrame, 0, outer.apex + GAP + compositionFrame.height / 2).align = 'center'
  return nodes
}

// Layer membership: use cases in application, ports and adapters in the adapter ring, the domain block in the
// domain (onion's services in their own ring), endpoints only where they sit inside the outermost ring.
export function assignLayers(nodes: LayoutNode[], serviceItems: DomainItem[]) {
  const serviceIds = new Set(serviceItems.map((i) => i.id))
  const layerOf = (n: LayoutNode): RingRole | undefined => {
    if (n.kind === 'useCase') return 'application'
    if (n.kind === 'port' || n.kind === 'portLabel' || n.kind === 'adapter') return 'adapters'
    if (n.kind === 'actor' || n.kind === 'external') return undefined
    if (n.kind === 'composition') return undefined
    return serviceIds.has(n.ref) ? 'domainServices' : 'domain'
  }
  for (const n of nodes) n.layer = layerOf(n)
}
