import { polarPoint, ringedArcAngles } from '../model/rings'
import type { OnionDependency, OnionElement, OnionFile } from '../model/schema'
import type { RingedKind } from '../model/ringedKinds'
import { countCrossings } from './crossings'
import { minimizeCrossings, neighborLookup, type CrossingGroup } from './crossingMinimization'
import type { Box, LayoutRing, Point } from './layout'
import { routeEdgesAroundLabels } from './edgeRouting'
import { endpointLayout, ringedBounds, ringedElementHeight, ringedElementWidth, ringOutlines, ringSlotRadii } from './ringed'

/** An element placed on its ring's circumference (REQ-07). */
export interface OnionElementLayout {
  key: string
  ref: string
  ringRole: string
  name: string
  kind?: RingedKind
  x: number
  y: number
}

/** An actor or external system, placed outside the outer ring (REQ-05). */
export interface OnionEndpointLayout {
  key: string
  ref: string
  kind: 'actor' | 'external'
  name: string
  targetId?: string
  x: number
  y: number
}

/** A dependency arrow (element → element) or an endpoint arrow (endpoint → its outer-ring target). `fromRef`/
 * `toRef` — the element/endpoint refs it connects, not just their screen coordinates — are what Decision 1
 * (Overview mode) filters edges by: only the ones touching the hovered/selected element. */
export interface OnionEdgeLayout {
  key: string
  kind: 'dependency' | 'endpoint'
  fromRef: string
  toRef: string
  from: Point
  to: Point
  /** The quadratic control point Detailed view bows this arrow through, kept clear of every ring title. */
  control: Point
}

export interface OnionLayoutModel {
  rings: LayoutRing[]
  elements: OnionElementLayout[]
  endpoints: OnionEndpointLayout[]
  edges: OnionEdgeLayout[]
  bounds: Box
}

/** Builds the whole model from a given per-ring element ORDER (`orderedElementsOn`) — everything Decision 3 never
 * changes: ring sizing, element/endpoint placement, edges. Called twice by `layoutOnion` below (raw document
 * order, and the barycenter-optimised order) so it can pick whichever actually has fewer crossings, never trusting
 * the heuristic blind. */
function buildOnionModel(doc: OnionFile, orderedElementsOn: (role: string) => readonly OnionElement[]): OnionLayoutModel {
  // Each ring's elements, by angle (REQ-07's spacing rule) and rendered box width, so a ring can grow to fit them
  // (`ringOutlines`) before its own radius — and thus their final positions — is known.
  const slotsOf = (role: string) => {
    const onRing = orderedElementsOn(role)
    const ringIndex = doc.rings.findIndex((r) => r.role === role)
    const angles = ringedArcAngles(onRing.length, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI, ringIndex)
    return onRing.map((e, k) => ({ angle: angles[k], width: ringedElementWidth(e.name, e.kind), height: ringedElementHeight(e.name, e.kind) }))
  }
  const rings = ringOutlines(doc.rings, slotsOf)

  // Elements: grouped by ring, spread evenly around that ring's circumference (REQ-07) at its own band's MID
  // radius (never the ring's outer edge, which the next ring out paints over) — in whichever order the caller
  // handed in.
  const elements: OnionElementLayout[] = rings.flatMap((ring, i) => {
    const onRing = orderedElementsOn(ring.role)
    const angles = ringedArcAngles(onRing.length, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI, i)
    const radii = ringSlotRadii(ring, rings[i - 1], angles)
    return onRing.map((e, k) => ({ key: `element:${e.id}`, ref: e.id, ringRole: e.ringRole, name: e.name, kind: e.kind, ...polarPoint(radii[k], angles[k]) }))
  })
  const elementAt = new Map(elements.map((e) => [e.ref, e]))

  const outer = rings[rings.length - 1]
  const outerElements = elements.filter((e) => e.ringRole === outer.role).map((e) => ({ x: e.x, y: e.y, width: ringedElementWidth(e.name, e.kind), height: ringedElementHeight(e.name, e.kind) }))
  const { endpoints, extraReach } = endpointLayout(doc.actors, doc.externals, outer, outerElements, elementAt)

  const dependencyEdges: Omit<OnionEdgeLayout, 'control'>[] = doc.dependencies.flatMap((dep: OnionDependency) => {
    const from = elementAt.get(dep.fromId)
    const to = elementAt.get(dep.toId)
    return from && to
      ? [{ key: `dependency:${dep.id}`, kind: 'dependency' as const, fromRef: dep.fromId, toRef: dep.toId, from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y } }]
      : []
  })
  const endpointEdges: Omit<OnionEdgeLayout, 'control'>[] = endpoints.flatMap((endpoint) => {
    const target = endpoint.targetId ? elementAt.get(endpoint.targetId) : undefined
    return target
      ? [{ key: `endpoint-edge:${endpoint.ref}`, kind: 'endpoint' as const, fromRef: endpoint.ref, toRef: endpoint.targetId!, from: { x: endpoint.x, y: endpoint.y }, to: { x: target.x, y: target.y } }]
      : []
  })

  return {
    rings,
    elements,
    endpoints,
    edges: routeEdgesAroundLabels([...dependencyEdges, ...endpointEdges], rings),
    bounds: ringedBounds(outer, extraReach),
  }
}

/** Innermost-first (REQ-02) — `doc.rings[0]` is the domain, the one big sentence-case title; every outer ring
 * (built from it outward) grows from its own inner neighbour (`ringOutlines`, ADR-01: shared with Clean). The
 * document's own author order is always respected here (ADR-XX) — Decision 3's crossing minimisation moved to
 * `tidyOnionOrder` below, an explicit "Tidy ring order" action rather than a silent layout-time reshuffle. */
export function layoutOnion(doc: OnionFile): OnionLayoutModel {
  return buildOnionModel(doc, (role) => doc.elements.filter((e) => e.ringRole === role))
}

/** Decision 3, now the explicit "Tidy ring order" action: reorders each ring's own elements to reduce
 * dependency-edge crossings — a full circle is one group per ring (a Clean sector's own wedge is the
 * finer-grained equivalent, `tidyCleanOrder`). The barycenter heuristic isn't guaranteed to improve every graph
 * on every pass count, so its result is only ever KEPT if it actually reduces crossings versus the document's
 * CURRENT order — measured with the same `countCrossings` the example suite pins its numbers with, never
 * assumed; returns `undefined` (a no-op) otherwise, so a caller can tell nothing changed. */
export function tidyOnionOrder(doc: OnionFile): OnionFile | undefined {
  const original = buildOnionModel(doc, (role) => doc.elements.filter((e) => e.ringRole === role))

  const elementById = new Map(doc.elements.map((e) => [e.id, e]))
  const ringGroups: CrossingGroup[] = doc.rings.map((r) => ({
    key: r.role,
    refs: doc.elements.filter((e) => e.ringRole === r.role).map((e) => e.id),
    startAngle: -Math.PI / 2,
    endAngle: -Math.PI / 2 + 2 * Math.PI,
  }))
  const optimizedOrder = minimizeCrossings(ringGroups, neighborLookup(doc.dependencies))
  const optimizedOrderOn = (role: string) => (optimizedOrder.get(role) ?? []).map((id) => elementById.get(id)!)
  const optimized = buildOnionModel(doc, optimizedOrderOn)

  if (countCrossings(optimized.edges) >= countCrossings(original.edges)) return undefined
  return { ...doc, elements: doc.rings.flatMap((r) => optimizedOrderOn(r.role)) }
}
