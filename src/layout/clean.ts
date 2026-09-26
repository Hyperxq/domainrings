import { arcPositions } from '../model/rings'
import type { CleanFile, CleanRingRole } from '../model/schema'
import type { Box, LayoutRing } from './layout'
import { endpointLayout, ringedBounds, ringOutlines } from './ringed'

/** A sector's own wedge of its ring (REQ-08) — the angular sub-range its elements are spread inside, and the
 * range `render/band.ts`'s divider primitive and `cleanInsertion.ts`'s element "+" both place themselves against. */
export interface CleanSectorWedge {
  key: string
  ref: string
  ringRole: CleanRingRole
  name: string
  startAngle: number
  endAngle: number
}

/** An element placed inside its sector's wedge (REQ-08) — `ringRole` is resolved through the sector (ADR-02),
 * never stored on the element itself, matching the shared `RingedElementLayout` shape Onion's elements use too. */
export interface CleanElementLayout {
  key: string
  ref: string
  ringRole: CleanRingRole
  name: string
  x: number
  y: number
}

/** An actor or external system, placed outside the outer ring (REQ-07) — same contract as Onion's own. */
export interface CleanEndpointLayout {
  key: string
  ref: string
  kind: 'actor' | 'external'
  name: string
  targetId?: string
  x: number
  y: number
}

/** A dependency arrow (element → element) or an endpoint arrow (endpoint → its outer-ring target). */
export interface CleanEdgeLayout {
  key: string
  kind: 'dependency' | 'endpoint'
  from: { x: number; y: number }
  to: { x: number; y: number }
}

export interface CleanLayoutModel {
  rings: LayoutRing[]
  sectors: CleanSectorWedge[]
  elements: CleanElementLayout[]
  endpoints: CleanEndpointLayout[]
  edges: CleanEdgeLayout[]
  bounds: Box
}

/** Divides a ring's own sectors into N equal wedges, starting at the top (REQ-08) — array order decides wedge
 * order, same "re-adding shuffles existing" convention `ringCircumferencePositions` already accepts for Onion's
 * elements; a ring with 0 sectors has no wedges at all. */
function sectorWedges(doc: CleanFile): CleanSectorWedge[] {
  return doc.rings.flatMap((ring) => {
    const onRing = doc.sectors.filter((s) => s.ringRole === ring.role)
    const span = (2 * Math.PI) / onRing.length
    return onRing.map((sector, k) => ({
      key: `sector:${sector.id}`,
      ref: sector.id,
      ringRole: sector.ringRole,
      name: sector.name,
      startAngle: -Math.PI / 2 + k * span,
      endAngle: -Math.PI / 2 + (k + 1) * span,
    }))
  })
}

/** Innermost-first (REQ-02) — rings and their outlines are shared with Onion (`ringOutlines`, ADR-01); what's
 * genuinely Clean-only is the sector sub-division of each ring into wedges and placing elements inside their
 * own wedge (`arcPositions`) rather than around the whole ring. */
export function layoutClean(doc: CleanFile): CleanLayoutModel {
  const rings = ringOutlines(doc.rings)
  const ringByRole = new Map(rings.map((r) => [r.role, r]))

  const sectors = sectorWedges(doc)

  const elements: CleanElementLayout[] = sectors.flatMap((sector) => {
    const ring = ringByRole.get(sector.ringRole)!
    const onSector = doc.elements.filter((e) => e.sectorId === sector.ref)
    const positions = arcPositions(onSector.length, ring, sector.startAngle, sector.endAngle)
    return onSector.map((e, k) => ({ key: `element:${e.id}`, ref: e.id, ringRole: sector.ringRole, name: e.name, ...positions[k] }))
  })
  const elementAt = new Map(elements.map((e) => [e.ref, e]))

  const outer = rings[rings.length - 1]
  const { endpoints, extraReach } = endpointLayout(doc.actors, doc.externals, outer)

  const dependencyEdges: CleanEdgeLayout[] = doc.dependencies.flatMap((dep) => {
    const from = elementAt.get(dep.fromId)
    const to = elementAt.get(dep.toId)
    return from && to ? [{ key: `dependency:${dep.id}`, kind: 'dependency' as const, from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y } }] : []
  })
  const endpointEdges: CleanEdgeLayout[] = endpoints.flatMap((endpoint) => {
    const target = endpoint.targetId ? elementAt.get(endpoint.targetId) : undefined
    return target ? [{ key: `endpoint-edge:${endpoint.ref}`, kind: 'endpoint' as const, from: { x: endpoint.x, y: endpoint.y }, to: { x: target.x, y: target.y } }] : []
  })

  return {
    rings,
    sectors,
    elements,
    endpoints,
    edges: [...dependencyEdges, ...endpointEdges],
    bounds: ringedBounds(outer, extraReach),
  }
}
