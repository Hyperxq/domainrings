import { HEXAGONAL_KIND, type RingRole } from '../model/kinds'
import { defaultWall, type Diagram, type Port, type Side, type Wall } from '../model/schema'
import type { Thread } from '../model/threads'
import { dot, type Box, type Point } from './geometry'
import { sizeBands } from './hexagon/bands'
import { layoutBounds } from './hexagon/bounds'
import { boxFrames } from './hexagon/boxFrames'
import { planChains } from './hexagon/chains'
import { layCentre } from './hexagon/centreBlock'
import { placeElements, planPairs } from './hexagon/elements'
import { assignLayers, placeNodes } from './hexagon/nodes'
import { ringTitles } from './hexagon/ringTitles'
import { corridorCentre, planHops, routeEdges, trackOwners, type Terminal } from './hexagon/routes'
import { markThreads } from './hexagon/threadMarks'
import { seatUseCases } from './hexagon/useCaseSeating'
import { VERTEX, wallFrame } from './hexagon/walls'
import { COS30, hexagon, type Outline } from './outline'
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
  | 'composition'

/** A use case's thread as the layout carries it: whose flow, and the palette slot it draws with. */
export interface ThreadMark {
  id: string
  slot: number
}

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
  /** Hexagons: the wall the box sits on; a port's adapters and their actors or externals share its wall. */
  wall?: Wall
  /** Hexagons: the threads whose flow passes through this box, in use case order. */
  threads?: ThreadMark[]
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
  /** import: arrow; wiring: composition root. */
  kind: 'import' | 'wiring'
  points: Point[]
  label?: string
  labelAt?: Point
  /** Index of the point where the path crosses into the domain fill; the part from there on is drawn in the domain's own tone. */
  intoDomain?: number
  /** Hexagons, import edges: the refs of the elements it joins; `to` is absent when it ends on the domain fill itself. */
  from?: string
  to?: string
  /** Hexagons: the one thread this edge belongs to; absent when none or several do. */
  thread?: ThreadMark
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

/** Overview shrinks the domain model's aggregate cards to their headers; every other box, wall and edge stays as in Detailed. */
export type LayoutMode = 'detailed' | 'overview'

export interface LayoutOptions {
  mode?: LayoutMode
  /** Hexagons: the flows to mark on boxes and edges (`threadsOf`); without them the layout carries none. */
  threads?: readonly Thread[]
}

export interface LayoutModel {
  shape: 'hexagon'
  rings: LayoutRing[]
  /** Hexagons only: the domain model region inside the domain ring, present when the domain has an aggregate. */
  region?: Outline
  /** Hexagons only: dashed spokes from each outer vertex in to the matching domain vertex. */
  guides: { from: Point; to: Point }[]
  /** Hexagons only: the corridors the connections run along, as hexagons concentric with the rings through the middle of each band: the domain's, the application's, the infrastructure's and the external systems', innermost first. */
  corridors: Outline[]
  /** Hexagons only: the wall the external systems and actors are centred on, just outside the infrastructure ring. */
  externalWall: Outline
  nodes: LayoutNode[]
  edges: LayoutEdge[]
  texts: LayoutText[]
  bounds: Box
}

export function layoutDiagram(d: Diagram, { mode = 'detailed', threads = [] }: LayoutOptions = {}): LayoutModel {
  const overview = mode === 'overview'
  const config = HEXAGONAL_KIND
  const frames = boxFrames()
  const wallOf = (p: Port): Wall => p.wall ?? defaultWall(p.side)
  const slots = planChains(d, { port: frames.portFrame, adapter: frames.adapterFrame, leaf: frames.leafFrame })
  const seating = seatUseCases({ d, useCaseFrames: d.useCases.map(frames.useCaseFrame), slots, wallOf })
  const centre = layCentre({ d, overview, domainFrame: frames.domainFrame, seating })
  const elements = placeElements(d, frames, slots, seating)
  const pairs = planPairs(d, elements, new Set(centre.boxes.filter((b) => b.kind === 'aggregate').map((b) => b.ref)))

  // Threads are ranked in use case order, anything else after them: it sets the order of tracks and of lateral offsets.
  const order = new Map([...d.useCases.map((u) => u.id), ...pairs.map((p) => p.owner)].map((owner, i) => [owner, i] as const).reverse())
  const rank = (owner: string) => order.get(owner)!
  const terminals = new Map<string, Terminal>(elements.map((e) => [e.key, { wall: e.wall, layer: e.layer, u: e.u, width: e.frame.width, height: e.frame.height }]))
  for (const card of centre.boxes.filter((b) => b.kind === 'aggregate')) {
    const wall = centre.faces.get(card.ref)!
    const { n, dir } = wallFrame(wall)
    terminals.set(card.key, { wall, layer: 0, u: dot(card, dir), width: card.frame.width, height: card.frame.height, depth: dot(card, n) })
  }
  const hops = planHops(pairs, terminals, rank, centre.region.halfWidth)
  const owners = trackOwners(hops, rank)

  const titles = ringTitles(d)
  const radii = sizeBands({
    elements,
    inside: centre.boxes.map((b) => ({ x: b.x - b.frame.width / 2, y: b.y - b.frame.height / 2, width: b.frame.width, height: b.frame.height })),
    core: centre.region,
    tracks: owners.map((o) => o.length),
    titles,
  })
  // Rings, outermost first: the infrastructure, application and domain walls; the external systems stand on a wall of their own.
  const outlines = [3, 2, 1].map((i) => hexagon(radii[i] / COS30))
  const externalWall = hexagon(radii[4] / COS30)
  const domain = outlines[config.rings.length - 1]
  const outer = outlines[0]

  const { nodes, composition } = placeNodes({ d, elements, radii, outerApex: externalWall.apex, centre, frames })
  const edges = routeEdges({ hops, radii, owners, nodes, composition })
  const { texts, bounds } = layoutBounds(d, outer, nodes, edges)
  assignLayers(nodes)
  markThreads(nodes, edges, threads)

  // Spokes run along the centre-to-vertex lines, from each outer vertex in to the domain's, never over its fill.
  const guides = VERTEX.map((v) => ({ from: { x: v.x * outer.apex, y: v.y * outer.apex }, to: { x: v.x * domain.apex, y: v.y * domain.apex } }))
  // Each corridor runs through the middle of its band.
  const corridors = [0, 1, 2, 3].map((c) => hexagon(corridorCentre(radii, c) / COS30))

  return {
    shape: 'hexagon',
    rings: titles.rings(outlines),
    ...(centre.hasRegion ? { region: centre.region } : {}),
    guides,
    corridors,
    externalWall,
    nodes,
    edges,
    texts,
    bounds,
  }
}
