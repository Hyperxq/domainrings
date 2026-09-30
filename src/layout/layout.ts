import { HEXAGONAL_KIND, type RingRole } from '../model/kinds'
import type { Diagram, Side, Wall } from '../model/schema'
import type { Box, Point } from './geometry'
import { layoutBounds } from './hexagon/bounds'
import { boxFrames } from './hexagon/boxFrames'
import { layCentre } from './hexagon/centreBlock'
import { planBoxes } from './hexagon/columns'
import { assignLayers, placeNodes } from './hexagon/nodes'
import { solveRings } from './hexagon/ringSolver'
import { ringTitles } from './hexagon/ringTitles'
import { routeEdges } from './hexagon/routes'
import { seatUseCases } from './hexagon/useCaseSeating'
import { VERTEX } from './hexagon/walls'
import type { TextLine } from './text'

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
   * staggered across (`ringSlotRadius`, layout/ringOutlines.ts) — undefined for Hexagonal, which has no such concept. */
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

export function layoutDiagram(d: Diagram, { mode = 'detailed' }: LayoutOptions = {}): LayoutModel {
  const overview = mode === 'overview'
  const config = HEXAGONAL_KIND
  const frames = boxFrames(overview)
  const plan = planBoxes(d, overview, frames)
  const titles = ringTitles(d)
  const centre = layCentre({ d, overview, domainFrame: frames.domainFrame, titles })
  const useCaseFrames = d.useCases.map(frames.useCaseFrame)
  const appIndex = config.rings.findIndex((r) => r.role === 'application')
  const seating = seatUseCases({ d, overview, appIndex, useCaseFrames, declaredPorts: centre.declared.length, titles, plan, frames })

  const { outlines, domainShift } = solveRings({ d, overview, appIndex, titles, centre, plan, frames, useCaseFrames, seating })
  const app = outlines[appIndex]
  const insideApp = outlines[appIndex + 1]
  const outer = outlines[0]
  const domain = outlines[config.rings.length - 1]

  const { nodes, composition } = placeNodes({ d, overview, app, insideApp, outer, domain, titles, domainShift, centre, plan, frames, useCaseFrames, seating })
  const edges = routeEdges({ d, overview, nodes, composition, plan, app, insideApp, domain, outer, seating })
  const { texts, bounds } = layoutBounds(d, outer, nodes, edges)
  assignLayers(nodes, centre.serviceItems)

  // Spokes run along the centre-to-vertex lines, from each outer vertex in to the domain's, never over its fill.
  const guides = VERTEX.map((v) => ({ from: { x: v.x * outer.apex, y: v.y * outer.apex }, to: { x: v.x * domain.apex, y: v.y * domain.apex } }))

  return {
    shape: 'hexagon',
    rings: titles.rings(outlines),
    guides,
    nodes,
    edges,
    texts,
    bounds,
  }
}
