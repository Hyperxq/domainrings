import { HEXAGONAL_KIND } from '../../model/kinds'
import type { Diagram } from '../../model/schema'
import { dot, quadsOverlap, rectCorners } from '../geometry'
import { COS30, fitRing, halfWidthAt, hexagon, type Need, type Outline } from '../outline'
import type { BoxFrames } from './boxFrames'
import type { CentreBlock } from './centreBlock'
import type { BoxPlan, Planned } from './columns'
import type { RingTitles } from './ringTitles'
import { DOMAIN_RUN, GAP, LABEL_PAD_X, OUTSIDE_GAP, PAD } from './spacing'
import type { UseCaseSeating } from './useCaseSeating'
import { sectorApothem, wallFrame } from './walls'

/** Room between the domain title and the region under it. */
const TITLE_CLEAR = 8
const nearest = (y: number, height: number) => Math.max(0, Math.abs(y) - height / 2)
const farthest = (y: number, height: number) => Math.abs(y) + height / 2

export interface RingSolverInput {
  d: Diagram
  overview: boolean
  /** Index of the application ring in the kind's ring list. */
  appIndex: number
  titles: RingTitles
  centre: CentreBlock
  plan: BoxPlan
  frames: BoxFrames
  seating: UseCaseSeating
}

/**
 * Every ring's outline, inside-out: each ring holds its own content, fitted to the real box corners.
 */
export function solveRings({ d, overview, appIndex, titles, centre, plan, frames, seating }: RingSolverInput): Outline[] {
  const config = HEXAGONAL_KIND
  const { titleWidth, titleHeight, titleDepth, depthOf } = titles
  const { serviceFrames, servicesBlock } = centre
  const { ports, of, widths, wallBoxes, hasSlanted, sectored, localCorners, inwardOf, columnCorners, portLabels } = plan
  const { labelReach } = frames
  const { seats, seatsAt } = seating
  const last = config.rings.length - 1
  const boxQuad = (b: { x: number; y: number; frame: { width: number; height: number } }) => rectCorners(b.x, b.y, b.frame.width, b.frame.height)

  /**
   * For a candidate application ring: does a slanted-wall socket, an overview port name or a seated use case touch the
   * title (sectors keep each wall's own content apart)? The upper walls lean in exactly where the title sits, so this
   * is what usually sizes the ring once they are used.
   */
  const appClashes = (appO: Outline) => {
    const slantedSocket = wallBoxes
      .filter((b) => b.kind === 'port')
      .map((b) => {
        const { n, dir } = wallFrame(b.wall)
        return rectCorners(n.x * appO.halfWidth + dir.x * b.u, n.y * appO.halfWidth + dir.y * b.u, b.width, b.height)
      })
    const title = rectCorners(0, -appO.apex + titleDepth + titleHeight(appIndex) / 2, titleWidth(appIndex), titleHeight(appIndex))
    const labels = portLabels(appO).map((l) => rectCorners(l.x, l.y, l.frame.width, l.frame.height))
    // A port name is text like the title: touching it would read as one line.
    const titleRoom = rectCorners(0, -appO.apex + titleDepth + titleHeight(appIndex) / 2, titleWidth(appIndex) + GAP, titleHeight(appIndex) + GAP)
    if (labels.some((q) => quadsOverlap(q, titleRoom))) return true
    return [...slantedSocket, ...labels, ...seatsAt(appO).map(boxQuad)].some((q) => quadsOverlap(q, title))
  }

  // Rings, inside-out: each one holds its own content, fitted to the real box corners. The title above the
  // inner ring is absolute here; titles move up under the top vertex afterwards.
  const outlines: Outline[] = []

  for (let i = last; i >= 0; i--) {
    const role = config.rings[i].role
    const inner = outlines[i + 1]
    if (role === 'domain') {
      // The region sits under the title, with the room around it for the use cases' arrows; a title wider than the
      // region needs still has to fit between the ring's sides.
      outlines[i] = hexagon(Math.max(centre.region.apex + depthOf(i) + titleHeight(i) + TITLE_CLEAR, (titleWidth(i) / 2 + LABEL_PAD_X) / COS30))
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
        const clear = halfWidthAt(inner, nearest(p.y, p.height)) + GAP
        side.push({ x: clear + widths[p.side].socketHalf + labelReach(ports.get(p.ref)!), y: farthest(p.y, p.height) })
      }
    }
    vertical.push({ x: 0, y: stackTop + GAP + titleHeight(i) + titleDepth })
    if (role === 'adapters') {
      for (const p of of('adapter')) {
        const w = widths[p.side]
        side.push({ x: halfWidthAt(inner, p.y) + w.socketHalf + GAP + w.adapter + PAD, y: farthest(p.y, p.height) })
      }
    }
    let minApothem = 0
    if (role === 'application') {
      for (const b of wallBoxes.filter((b) => !b.outer)) for (const c of localCorners(b)) minApothem = Math.max(minApothem, sectorApothem(c.u, c.v))
      for (const b of wallBoxes.filter((b) => b.kind === 'port')) minApothem = Math.max(minApothem, inner.halfWidth + GAP + inwardOf(b))
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
    if (role === 'application' && (hasSlanted || overview || d.useCases.length > 0)) {
      for (let guard = 0; guard < 4000 && appClashes(fitted); guard++) fitted = hexagon(fitted.apex * 1.001)
    }
    // The title must fit titleDepth under the top: the hexagon's slope is wide enough by construction, so only
    // its straight width can bind.
    const w = titleWidth(i) / 2 + LABEL_PAD_X
    outlines[i] = hexagon(Math.max(fitted.apex, w / COS30))
  }
  return outlines
}
