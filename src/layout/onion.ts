import { arcAngles, ringCircumferencePositions } from '../model/rings'
import type { OnionDependency, OnionFile, OnionRingRole } from '../model/schema'
import type { Box, LayoutRing, Point } from './layout'
import { endpointLayout, ringedBounds, ringElementRadius, RINGED_ELEMENT_HEIGHT, ringedElementWidth, ringOutlines } from './ringed'

/** An element placed on its ring's circumference (REQ-07). */
export interface OnionElementLayout {
  key: string
  ref: string
  ringRole: OnionRingRole
  name: string
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
}

export interface OnionLayoutModel {
  rings: LayoutRing[]
  elements: OnionElementLayout[]
  endpoints: OnionEndpointLayout[]
  edges: OnionEdgeLayout[]
  bounds: Box
}

/** Innermost-first (REQ-02) — `doc.rings[0]` is the domain, the one big sentence-case title; every outer ring
 * (built from it outward) grows from its own inner neighbour (`ringOutlines`, ADR-01: shared with Clean). */
export function layoutOnion(doc: OnionFile): OnionLayoutModel {
  // Each ring's elements, by angle (REQ-07's spacing rule) and rendered box width, so a ring can grow to fit them
  // (`ringOutlines`) before its own radius — and thus their final positions — is known.
  const slotsOf = (role: OnionRingRole) => {
    const onRing = doc.elements.filter((e) => e.ringRole === role)
    const angles = arcAngles(onRing.length, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI)
    return onRing.map((e, k) => ({ angle: angles[k], width: ringedElementWidth(e.name) }))
  }
  const rings = ringOutlines(doc.rings, slotsOf)

  // Elements: grouped by ring, spread evenly around that ring's circumference (REQ-07) at its own band's MID
  // radius (never the ring's outer edge, which the next ring out paints over) — array order decides position
  // order, so re-adding shuffles existing elements' angles; acceptable, nothing in REQ-07 promises a stable angle
  // per element across edits.
  const elements: OnionElementLayout[] = rings.flatMap((ring, i) => {
    const onRing = doc.elements.filter((e) => e.ringRole === ring.role)
    const positions = ringCircumferencePositions(onRing.length, { halfWidth: ringElementRadius(ring, rings[i - 1]) })
    return onRing.map((e, k) => ({ key: `element:${e.id}`, ref: e.id, ringRole: e.ringRole, name: e.name, ...positions[k] }))
  })
  const elementAt = new Map(elements.map((e) => [e.ref, e]))

  const outer = rings[rings.length - 1]
  const outerElements = elements.filter((e) => e.ringRole === outer.role).map((e) => ({ x: e.x, y: e.y, width: ringedElementWidth(e.name), height: RINGED_ELEMENT_HEIGHT }))
  const { endpoints, extraReach } = endpointLayout(doc.actors, doc.externals, outer, outerElements)

  const dependencyEdges: OnionEdgeLayout[] = doc.dependencies.flatMap((dep: OnionDependency) => {
    const from = elementAt.get(dep.fromId)
    const to = elementAt.get(dep.toId)
    return from && to
      ? [{ key: `dependency:${dep.id}`, kind: 'dependency' as const, fromRef: dep.fromId, toRef: dep.toId, from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y } }]
      : []
  })
  const endpointEdges: OnionEdgeLayout[] = endpoints.flatMap((endpoint) => {
    const target = endpoint.targetId ? elementAt.get(endpoint.targetId) : undefined
    return target
      ? [{ key: `endpoint-edge:${endpoint.ref}`, kind: 'endpoint' as const, fromRef: endpoint.ref, toRef: endpoint.targetId!, from: { x: endpoint.x, y: endpoint.y }, to: { x: target.x, y: target.y } }]
      : []
  })

  return {
    rings,
    elements,
    endpoints,
    edges: [...dependencyEdges, ...endpointEdges],
    bounds: ringedBounds(outer, extraReach),
  }
}
