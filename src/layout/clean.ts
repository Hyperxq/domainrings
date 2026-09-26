import { arcAngles, arcPositions } from '../model/rings'
import type { CleanElement, CleanFile, CleanRingRole } from '../model/schema'
import { countCrossings } from './crossings'
import { minimizeCrossings, neighborLookup, type CrossingGroup } from './crossingMinimization'
import type { Box, LayoutRing } from './layout'
import { endpointLayout, ringedBounds, ringElementRadius, RINGED_ELEMENT_HEIGHT, ringedElementWidth, ringOutlines } from './ringed'

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

/** A dependency arrow (element → element) or an endpoint arrow (endpoint → its outer-ring target). `fromRef`/
 * `toRef` — the element/endpoint refs it connects, not just their screen coordinates — are what Decision 1
 * (Overview mode) filters edges by: only the ones touching the hovered/selected element. */
export interface CleanEdgeLayout {
  key: string
  kind: 'dependency' | 'endpoint'
  fromRef: string
  toRef: string
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

/** Builds the whole model from a given per-sector element ORDER (`orderedElementsIn`) — everything Decision 3
 * never changes: ring/sector sizing, element/endpoint placement, edges. Called twice by `layoutClean` below (raw
 * document order, and the barycenter-optimised order) so it can pick whichever actually has fewer crossings,
 * never trusting the heuristic blind. */
function buildCleanModel(doc: CleanFile, sectors: CleanSectorWedge[], orderedElementsIn: (sectorRef: string) => readonly CleanElement[]): CleanLayoutModel {
  // Every sector's own elements, flattened onto their shared ring (REQ-08's per-wedge spacing rule, but grouped
  // by ring rather than by sector) — so a ring grows to fit ALL of them, including crowding right at a wedge
  // boundary between two sectors, with no sector-specific code in `ringOutlines` at all (ADR-01).
  const slotsOf = (role: CleanRingRole) =>
    sectors
      .filter((s) => s.ringRole === role)
      .flatMap((sector) => {
        const onSector = orderedElementsIn(sector.ref)
        const angles = arcAngles(onSector.length, sector.startAngle, sector.endAngle)
        return onSector.map((e, k) => ({ angle: angles[k], width: ringedElementWidth(e.name) }))
      })
  const rings = ringOutlines(doc.rings, slotsOf)
  const ringByRole = new Map(rings.map((r, i) => [r.role, { ring: r, inner: rings[i - 1] }]))

  // Elements sit inside their own sector's wedge (REQ-08), at their ring's own band MID radius (never its outer
  // edge, which the next ring out paints over — same fix as Onion's own element placement, ADR-01) — in whichever
  // order the caller handed in.
  const elements: CleanElementLayout[] = sectors.flatMap((sector) => {
    const { ring, inner } = ringByRole.get(sector.ringRole)!
    const onSector = orderedElementsIn(sector.ref)
    const positions = arcPositions(onSector.length, { halfWidth: ringElementRadius(ring, inner) }, sector.startAngle, sector.endAngle)
    return onSector.map((e, k) => ({ key: `element:${e.id}`, ref: e.id, ringRole: sector.ringRole, name: e.name, ...positions[k] }))
  })
  const elementAt = new Map(elements.map((e) => [e.ref, e]))

  const outer = rings[rings.length - 1]
  const outerElements = elements.filter((e) => e.ringRole === outer.role).map((e) => ({ x: e.x, y: e.y, width: ringedElementWidth(e.name), height: RINGED_ELEMENT_HEIGHT }))
  const { endpoints, extraReach } = endpointLayout(doc.actors, doc.externals, outer, outerElements)

  const dependencyEdges: CleanEdgeLayout[] = doc.dependencies.flatMap((dep) => {
    const from = elementAt.get(dep.fromId)
    const to = elementAt.get(dep.toId)
    return from && to
      ? [{ key: `dependency:${dep.id}`, kind: 'dependency' as const, fromRef: dep.fromId, toRef: dep.toId, from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y } }]
      : []
  })
  const endpointEdges: CleanEdgeLayout[] = endpoints.flatMap((endpoint) => {
    const target = endpoint.targetId ? elementAt.get(endpoint.targetId) : undefined
    return target
      ? [{ key: `endpoint-edge:${endpoint.ref}`, kind: 'endpoint' as const, fromRef: endpoint.ref, toRef: endpoint.targetId!, from: { x: endpoint.x, y: endpoint.y }, to: { x: target.x, y: target.y } }]
      : []
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

/** Innermost-first (REQ-02) — rings and their outlines are shared with Onion (`ringOutlines`, ADR-01); what's
 * genuinely Clean-only is the sector sub-division of each ring into wedges and placing elements inside their
 * own wedge (`arcPositions`) rather than around the whole ring. */
export function layoutClean(doc: CleanFile): CleanLayoutModel {
  const sectors = sectorWedges(doc)

  const originalOrderIn = (sectorRef: string) => doc.elements.filter((e) => e.sectorId === sectorRef)
  const original = buildCleanModel(doc, sectors, originalOrderIn)

  // Decision 3/4: reorder each SECTOR's own elements (never across sectors — a sector's own wedge is the group,
  // finer-grained than Onion's whole-ring group) to reduce dependency-edge crossings. As with Onion, the
  // barycenter result is only kept if it actually has no more crossings than the untouched order.
  const elementById = new Map(doc.elements.map((e) => [e.id, e]))
  const sectorGroups: CrossingGroup[] = sectors.map((s) => ({
    key: s.ref,
    refs: doc.elements.filter((e) => e.sectorId === s.ref).map((e) => e.id),
    startAngle: s.startAngle,
    endAngle: s.endAngle,
  }))
  const optimizedOrder = minimizeCrossings(sectorGroups, neighborLookup(doc.dependencies))
  const optimizedOrderIn = (sectorRef: string) => (optimizedOrder.get(sectorRef) ?? []).map((id) => elementById.get(id)!)
  const optimized = buildCleanModel(doc, sectors, optimizedOrderIn)

  return countCrossings(optimized.edges) <= countCrossings(original.edges) ? optimized : original
}
