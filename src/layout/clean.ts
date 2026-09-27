import { polarPoint, ringedArcAngles } from '../model/rings'
import type { CleanElement, CleanFile, CleanRingRole } from '../model/schema'
import { countCrossings } from './crossings'
import { minimizeCrossings, neighborLookup, type CrossingGroup } from './crossingMinimization'
import type { Box, LayoutRing } from './layout'
import { endpointLayout, ringedBounds, ringedElementHeight, ringedElementWidth, ringOutlines, ringSlotRadii, TITLE_ARC_PAD, type RingedExtraLabel } from './ringed'
import { measure, RING_SUBTITLE } from './text'

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
  // boundary between two sectors; the only Clean-specific input `ringOutlines` takes is each sector's own label
  // footprint below (`extraLabelsOf`), everything else about HOW a ring sizes against slots/labels stays generic.
  // Only a LONE sector (exactly one element) ever coincides with its own label in the first place — `arcAngles`
  // spreads two or more evenly across the whole wedge, which already keeps them well clear of dead-centre in
  // practice; growing the ring against every sector's own label regardless measured 2x-plus larger rings on
  // clean-advanced.hexa, most of it paying for a coincidence that was never actually happening.
  const loneSectorIndex = (role: CleanRingRole) => new Map(sectors.filter((s) => s.ringRole === role && orderedElementsIn(s.ref).length === 1).map((s, idx) => [s.ref, idx]))
  const slotsOf = (role: CleanRingRole) => {
    const loneIndex = loneSectorIndex(role)
    return sectors
      .filter((s) => s.ringRole === role)
      .flatMap((sector) => {
        const onSector = orderedElementsIn(sector.ref)
        const ringIndex = doc.rings.findIndex((r) => r.role === sector.ringRole)
        const angles = ringedArcAngles(onSector.length, sector.startAngle, sector.endAngle, ringIndex)
        const labelIndex = loneIndex.get(sector.ref)
        return onSector.map((e, k) => ({ angle: angles[k], width: ringedElementWidth(e.name), height: ringedElementHeight(e.name), labelIndex }))
      })
  }
  // Decision 5's ring-title clearance, generalized to Clean's own per-sector name (`render/CleanDiagram.tsx`'s
  // `SectorLabel`, centred at its own wedge's mid-angle, never just the top) — the reported "Shipping" sector name
  // sitting under the "Shipment" box, clean-advanced.hexa. Same `loneSectorIndex` order as `slotsOf` above, so a
  // label's own index always lines up with the one sector's slot it actually belongs to.
  const extraLabelsOf = (role: CleanRingRole): RingedExtraLabel[] => {
    const loneSectors = sectors.filter((s) => s.ringRole === role && orderedElementsIn(s.ref).length === 1)
    return loneSectors.map((s) => ({ angle: (s.startAngle + s.endAngle) / 2, arcLength: measure(s.name, RING_SUBTITLE) + 2 * TITLE_ARC_PAD }))
  }
  const rings = ringOutlines(doc.rings, slotsOf, extraLabelsOf)
  const ringByRole = new Map(rings.map((r, i) => [r.role, { ring: r, inner: rings[i - 1] }]))

  // Every ring's own slot radii, resolved ONCE across its whole flattened sector order (`ringSlotRadii` needs the
  // full list — Decision 7's lane assignment is relative to a slot's own position among ALL of its ring's slots,
  // the same order `slotsOf` above sized that ring against), then sliced back out per sector below. `risksLabel`
  // (parallel to `angles`) flags a LONE sector's own single element — the one Decision 7 gives another radial lane
  // to instead of sitting exactly where its own sector's curved name always centres (`ringOutlines`'s own
  // `extraLabelsOf`, same lone-sector test).
  const anglesByRole = new Map<CleanRingRole, number[]>()
  const risksLabelByRole = new Map<CleanRingRole, boolean[]>()
  for (const sector of sectors) {
    const ringIndex = doc.rings.findIndex((r) => r.role === sector.ringRole)
    const onSector = orderedElementsIn(sector.ref)
    const angles = ringedArcAngles(onSector.length, sector.startAngle, sector.endAngle, ringIndex)
    anglesByRole.set(sector.ringRole, [...(anglesByRole.get(sector.ringRole) ?? []), ...angles])
    risksLabelByRole.set(sector.ringRole, [...(risksLabelByRole.get(sector.ringRole) ?? []), ...angles.map(() => onSector.length === 1)])
  }
  const radiiByRole = new Map(
    [...anglesByRole].map(([role, angles]) => {
      const { ring, inner } = ringByRole.get(role)!
      return [role, ringSlotRadii(ring, inner, angles, risksLabelByRole.get(role)!)] as const
    }),
  )
  const slotOffset = new Map<string, number>()
  const slotCountByRole = new Map<CleanRingRole, number>()
  for (const sector of sectors) {
    const start = slotCountByRole.get(sector.ringRole) ?? 0
    slotOffset.set(sector.ref, start)
    slotCountByRole.set(sector.ringRole, start + orderedElementsIn(sector.ref).length)
  }

  // Elements sit inside their own sector's wedge (REQ-08), staggered across their ring's own radial lanes
  // (Decision 7, never its outer edge, which the next ring out paints over — same fix as Onion's own element
  // placement, ADR-01) — in whichever order the caller handed in.
  const elements: CleanElementLayout[] = sectors.flatMap((sector) => {
    const onSector = orderedElementsIn(sector.ref)
    const ringIndex = doc.rings.findIndex((r) => r.role === sector.ringRole)
    const angles = ringedArcAngles(onSector.length, sector.startAngle, sector.endAngle, ringIndex)
    const offset = slotOffset.get(sector.ref)!
    const radii = radiiByRole.get(sector.ringRole)!
    return onSector.map((e, k) => {
      const radius = radii[offset + k]
      return { key: `element:${e.id}`, ref: e.id, ringRole: sector.ringRole, name: e.name, ...polarPoint(radius, angles[k]) }
    })
  })
  const elementAt = new Map(elements.map((e) => [e.ref, e]))

  const outer = rings[rings.length - 1]
  const outerElements = elements.filter((e) => e.ringRole === outer.role).map((e) => ({ x: e.x, y: e.y, width: ringedElementWidth(e.name), height: ringedElementHeight(e.name) }))
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
 * genuinely Clean-only is the sector sub-division of each ring into wedges and placing elements inside their own
 * wedge (`arcAngles`) rather than around the whole ring. The document's own author order is always respected here
 * (ADR-XX) — Decision 3's crossing minimisation moved to `tidyCleanOrder` below, an explicit "Tidy ring order"
 * action rather than a silent layout-time reshuffle. */
export function layoutClean(doc: CleanFile): CleanLayoutModel {
  const sectors = sectorWedges(doc)
  return buildCleanModel(doc, sectors, (sectorRef) => doc.elements.filter((e) => e.sectorId === sectorRef))
}

/** Decision 3/4, now the explicit "Tidy ring order" action: reorders each SECTOR's own elements (never across
 * sectors — a sector's own wedge is the group, finer-grained than Onion's whole-ring group) to reduce
 * dependency-edge crossings. As with `tidyOnionOrder`, the barycenter result is only kept if it actually reduces
 * crossings versus the document's CURRENT order; returns `undefined` (a no-op) otherwise. */
export function tidyCleanOrder(doc: CleanFile): CleanFile | undefined {
  const sectors = sectorWedges(doc)
  const originalOrderIn = (sectorRef: string) => doc.elements.filter((e) => e.sectorId === sectorRef)
  const original = buildCleanModel(doc, sectors, originalOrderIn)

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

  if (countCrossings(optimized.edges) >= countCrossings(original.edges)) return undefined
  return { ...doc, elements: sectors.flatMap((s) => optimizedOrderIn(s.ref)) }
}
