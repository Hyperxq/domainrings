import { ringCircumferencePositions } from '../model/rings'
import type { OnionDependency, OnionEndpoint, OnionFile, OnionRingRole } from '../model/schema'
import { circle, type Box, type LayoutRing, type Outline, type Point } from './layout'
import { DOMAIN_TITLE, measure, RING_LABEL } from './text'

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

/** Same floor as the Hexagonal/Clean rings' MIN_BAND — keeps ring bands visually consistent across kinds. */
const MIN_BAND = 36
const LABEL_PAD_X = 8
const MARGIN = 16
const TITLE_LINE = RING_LABEL.size + 4
const SUBTITLE_GAP = 4

/** Innermost-first (REQ-02) — `doc.rings[0]` is the domain, the one big sentence-case title; every outer ring
 * (built from it outward) grows from its own inner neighbour, mirroring layoutDiagram's domain-outward solve. */
export function layoutOnion(doc: OnionFile): OnionLayoutModel {
  const last = doc.rings.length - 1
  const outlines: Outline[] = []
  for (let i = 0; i <= last; i++) {
    const spec = doc.rings[i]
    const innermost = i === 0
    const metrics = innermost ? DOMAIN_TITLE : RING_LABEL
    const titleRadius = measure(spec.name, metrics) / 2 + LABEL_PAD_X
    const inner = outlines[i - 1]
    outlines[i] = circle(Math.max(inner ? inner.apex + MIN_BAND : 0, titleRadius))
  }

  const rings: LayoutRing[] = doc.rings.map((spec, i) => {
    const innermost = i === 0
    const title = innermost ? spec.name : spec.name.toUpperCase()
    const titleWidth = measure(title, innermost ? DOMAIN_TITLE : RING_LABEL)
    const titleHeight = innermost ? DOMAIN_TITLE.size + 4 : TITLE_LINE
    return {
      key: `ring:${spec.role}`,
      role: spec.role,
      title,
      ...outlines[i],
      labelAt: { x: 0, y: -outlines[i].apex + titleHeight / 2 },
      titleBox: { x: -titleWidth / 2, y: -outlines[i].apex, width: titleWidth, height: titleHeight + SUBTITLE_GAP },
    }
  })

  // Elements: grouped by ring, spread evenly around that ring's circumference (REQ-07) — array order decides
  // position order, so re-adding shuffles existing elements' angles; acceptable, nothing in REQ-07 promises a
  // stable angle per element across edits.
  const elements: OnionElementLayout[] = doc.rings.flatMap((ring, i) => {
    const onRing = doc.elements.filter((e) => e.ringRole === ring.role)
    const positions = ringCircumferencePositions(onRing.length, outlines[i])
    return onRing.map((e, k) => ({ key: `element:${e.id}`, ref: e.id, ringRole: e.ringRole, name: e.name, ...positions[k] }))
  })
  const elementAt = new Map(elements.map((e) => [e.ref, e]))

  // Endpoints: actors and externals share one virtual ring outside the outer ring (REQ-05) — no port/adapter.
  const endpointSpecs: { item: OnionEndpoint; kind: 'actor' | 'external' }[] = [
    ...doc.actors.map((item) => ({ item, kind: 'actor' as const })),
    ...doc.externals.map((item) => ({ item, kind: 'external' as const })),
  ]
  const endpointOutline = circle(outlines[last].apex + ENDPOINT_GAP)
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

  const outer = outlines[last]
  const reach = outer.apex + (endpointSpecs.length ? ENDPOINT_GAP + 24 : 0)
  return {
    rings,
    elements,
    endpoints,
    edges: [...dependencyEdges, ...endpointEdges],
    bounds: { x: -reach - MARGIN, y: -reach - MARGIN, width: 2 * (reach + MARGIN), height: 2 * (reach + MARGIN) },
  }
}
