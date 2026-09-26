import { ringCircumferencePositions } from '../model/rings'
import type { OnionDependency, OnionEndpoint, OnionFile, OnionRingRole } from '../model/schema'
import { circle, type Box, type LayoutRing, type Point } from './layout'
import { ringedBounds, ringOutlines } from './ringed'

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

/** A dependency arrow (element → element) or an endpoint arrow (endpoint → its outer-ring target). */
export interface OnionEdgeLayout {
  key: string
  kind: 'dependency' | 'endpoint'
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

/** How far outside the outer ring an actor/external sits (REQ-05: "outside the outer ring", no port/adapter). */
const ENDPOINT_GAP = 56

/** Innermost-first (REQ-02) — `doc.rings[0]` is the domain, the one big sentence-case title; every outer ring
 * (built from it outward) grows from its own inner neighbour (`ringOutlines`, ADR-01: shared with Clean). */
export function layoutOnion(doc: OnionFile): OnionLayoutModel {
  const rings = ringOutlines(doc.rings)

  // Elements: grouped by ring, spread evenly around that ring's circumference (REQ-07) — array order decides
  // position order, so re-adding shuffles existing elements' angles; acceptable, nothing in REQ-07 promises a
  // stable angle per element across edits.
  const elements: OnionElementLayout[] = rings.flatMap((ring) => {
    const onRing = doc.elements.filter((e) => e.ringRole === ring.role)
    const positions = ringCircumferencePositions(onRing.length, ring)
    return onRing.map((e, k) => ({ key: `element:${e.id}`, ref: e.id, ringRole: e.ringRole, name: e.name, ...positions[k] }))
  })
  const elementAt = new Map(elements.map((e) => [e.ref, e]))

  // Endpoints: actors and externals share one virtual ring outside the outer ring (REQ-05) — no port/adapter.
  const endpointSpecs: { item: OnionEndpoint; kind: 'actor' | 'external' }[] = [
    ...doc.actors.map((item) => ({ item, kind: 'actor' as const })),
    ...doc.externals.map((item) => ({ item, kind: 'external' as const })),
  ]
  const outer = rings[rings.length - 1]
  const endpointOutline = circle(outer.apex + ENDPOINT_GAP)
  const endpointPositions = ringCircumferencePositions(endpointSpecs.length, endpointOutline)
  const endpoints: OnionEndpointLayout[] = endpointSpecs.map(({ item, kind }, k) => ({
    key: `endpoint:${item.id}`,
    ref: item.id,
    kind,
    name: item.name,
    targetId: item.targetId,
    ...endpointPositions[k],
  }))

  const dependencyEdges: OnionEdgeLayout[] = doc.dependencies.flatMap((dep: OnionDependency) => {
    const from = elementAt.get(dep.fromId)
    const to = elementAt.get(dep.toId)
    return from && to ? [{ key: `dependency:${dep.id}`, kind: 'dependency' as const, from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y } }] : []
  })
  const endpointEdges: OnionEdgeLayout[] = endpoints.flatMap((endpoint) => {
    const target = endpoint.targetId ? elementAt.get(endpoint.targetId) : undefined
    return target ? [{ key: `endpoint-edge:${endpoint.ref}`, kind: 'endpoint' as const, from: { x: endpoint.x, y: endpoint.y }, to: { x: target.x, y: target.y } }] : []
  })

  return {
    rings,
    elements,
    endpoints,
    edges: [...dependencyEdges, ...endpointEdges],
    bounds: ringedBounds(outer, endpointSpecs.length ? ENDPOINT_GAP + 24 : 0),
  }
}
