import { arcAngles, outerRoleOf, polarPoint, ringedArcAngles } from '../model/rings'
import type { CleanFile, CleanRingRole } from '../model/schema'
import type { Point } from './geometry'
import type { CleanLayoutModel } from './clean'
import { elementGapPoints, endpointInsertionPoints } from './ringedInsertion'
import { ringedElementHeight, ringedElementWidth } from './ringedMetrics'
import { ringElementRadius, ringSlotRadii, risksLabelAt } from './ringOutlines'

/** The `PlusGlyph`'s own rendered footprint (`RingedCanvas.tsx`: a `r={10}` circle) as an axis-aligned box, for a
 * gap "+"'s own "would I actually sit on that?" check below — never exact for a circle, but a fair, cheap stand-in
 * for "close enough to read as touching". */
const PLUS_DIAMETER = 20

const boxesOverlap = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  Math.abs(a.x - b.x) < (a.width + b.width) / 2 && Math.abs(a.y - b.y) < (a.height + b.height) / 2

/** What a "+" creates (REQ-03, REQ-04, REQ-07) — a ring's own "+" adds a sector to it; a sector's own "+" adds an
 * element to it (never directly to a ring, REQ-04); an outer-ring element's "+"s add an actor/external. A gap
 * "+"'s own `beforeId` (only ever set between two real neighbours, or before the sector's own first element)
 * names which existing element the new one should land before (REQ: insert-at-position, `ringedDocument.addElement`)
 * — absent, it appends, exactly like the single "+" an empty sector still offers. */
export type CleanInsertionAction =
  | { kind: 'sector'; ringRole: CleanRingRole }
  | { kind: 'element'; sectorId: string; beforeId?: string }
  | { kind: 'endpoint'; collection: 'actors' | 'externals'; targetId: string }

export interface CleanInsertionPoint {
  key: string
  /** The ring whose hover reveals this "+" — always the outer ring for an endpoint action. */
  ringRole: CleanRingRole
  at: Point
  action: CleanInsertionAction
  label: string
}

/** One "+" per ring, at a fixed anchor point (REQ-03) — unlike an element slot, a sector is a wedge, not a point,
 * so its "+" doesn't need to move as sectors are added; one "+" per sector, at the circumference slot its next
 * element would take inside that sector's own wedge (REQ-04, REQ-08); one "+" each for an actor and an external
 * system beside every outer-ring element (REQ-07, via the shared `endpointInsertionPoints`, ADR-01). */
export function cleanInsertionPoints(model: CleanLayoutModel, doc: CleanFile): CleanInsertionPoint[] {
  const points: CleanInsertionPoint[] = []
  doc.rings.forEach((ring, i) => {
    // Same mid-band radius an element's own "+" sits at (`ringSlotRadii` below) — the ring's own OUTER edge
    // (the old `ringCircumferencePositions(1, model.rings[i])`) is exactly the line the ring's stroke paints on.
    // The angle (π/2, the BOTTOM) is `ringCircumferencePositions(1, …)`'s own lone-slot angle, kept as-is: the
    // ring's own title always centres at the TOP (-π/2), so the bottom USED to be where a "+" at this same
    // mid-band radius always stayed clear of it — true only while a ring's own top title was the sole curved
    // label it could ever meet. A single sector spanning the WHOLE ring has its own name centred at that exact
    // same bottom angle (`sectorWedges`' own mid-angle for a lone, full-circle sector) — the same alternate-lane
    // dodge the gap "+"s below need, queried for every one of this ring's own EXISTING sectors, not just theirs.
    const inner = model.rings[i - 1]
    const bottomRisksASectorLabel = model.sectors.some((s) => s.ringRole === ring.role && risksLabelAt(Math.PI / 2, (s.startAngle + s.endAngle) / 2))
    const radius = bottomRisksASectorLabel ? ringSlotRadii({ ...model.rings[i], tracks: 2 }, inner, [Math.PI / 2], [true])[0] : ringElementRadius(model.rings[i], inner)
    const at = polarPoint(radius, Math.PI / 2)
    points.push({ key: `sector:${ring.role}`, ringRole: ring.role, at, action: { kind: 'sector', ringRole: ring.role }, label: `Add sector to ${ring.name}` })
  })
  // One "+" in every gap between two neighbouring elements already inside a sector's own wedge, linear (unlike
  // Onion's whole ring, a sector has two real boundaries of its own — REQ-08 — so both count as gaps too, one
  // more than the sector has elements); one "+" for an empty sector instead, at the one slot a first element
  // would take. Every angle matches exactly where `layoutClean`'s real elements sit (`ringedArcAngles`), so a
  // gap's "+" always lands between the actual boxes it names, never a hypothetical re-spaced slot.
  for (const sector of model.sectors) {
    const ringIndex = model.rings.findIndex((r) => r.role === sector.ringRole)
    const ring = model.rings[ringIndex]
    const inner = model.rings[ringIndex - 1]
    const onSector = doc.elements.filter((e) => e.sectorId === sector.ref)
    // A gap "+" must clear this sector's own curved name (`SectorLabel`) just as much as a real element does. The
    // ring's own resolved `tracks` (Decision 7) may still be 1 — plenty for its own real elements, which this
    // sector's label was already sized to clear at their OWN angles — but a gap sits at a DIFFERENT angle, one
    // `ringOutlines`'s own sizing search never had a slot to check. Querying the radius a genuine SECOND lane
    // would sit at, within this ring's own EXISTING band (never asking it to grow), is enough to clear a small "+"
    // glyph regardless of how many tracks the ring itself actually settled on.
    const sectorCenterAngle = (sector.startAngle + sector.endAngle) / 2
    // A gap "+" must also clear the two real neighbours it sits between — the base (mid-band) radius already
    // keeps it off the ring's own circumference, but at a small enough radius a wide neighbour's own box (a long
    // name, `ringedElementWidth`) can still reach into the gap's own default mid-band spot even though the gap's
    // own ANGLE is correctly the midpoint between the two. Tries the mid-band radius first, then each of a
    // genuine two-lane split's own radii (`ringSlotRadii`'s own `slotRadiusAt`, queried directly by index rather
    // than trusting whichever `riskIndex` a single call happens to assign) — whichever first actually clears both
    // this sector's own label and every real neighbour, since blindly taking "lane 0" can just as easily move
    // TOWARD a neighbour sitting closer to the ring's own inner edge as away from it.
    const laneRadius = (angle: number, k: 0 | 1): number => ringSlotRadii({ ...ring, tracks: 2 }, inner, [angle, angle], [true, true])[k]
    const clearsEverything = (angle: number, radius: number, neighborIds: readonly (string | undefined)[]): boolean => {
      const at = polarPoint(radius, angle)
      const plusBox = { x: at.x, y: at.y, width: PLUS_DIAMETER, height: PLUS_DIAMETER }
      const neighborBoxes = neighborIds.flatMap((id) => {
        const el = id && model.elements.find((e) => e.ref === id)
        return el ? [{ x: el.x, y: el.y, width: ringedElementWidth(el.name, el.kind), height: ringedElementHeight(el.name, el.kind) }] : []
      })
      return neighborBoxes.every((box) => !boxesOverlap(plusBox, box))
    }
    const gapRadius = (angle: number, neighborIds: readonly (string | undefined)[] = []): number => {
      // The label always reads at exactly the ring's own mid-band radius (`titleFootprintBox`'s own `midR`) — a
      // lane split's own two radii are never that mid by construction, so risking the label rules the mid-band
      // candidate out entirely rather than merely trying it first and hoping a neighbour also happens to clear it.
      const base = ringSlotRadii(ring, inner, [angle])[0]
      const candidates = risksLabelAt(angle, sectorCenterAngle) ? [laneRadius(angle, 0), laneRadius(angle, 1)] : [base, laneRadius(angle, 0), laneRadius(angle, 1)]
      return candidates.find((r) => clearsEverything(angle, r, neighborIds)) ?? candidates[0]
    }
    if (!onSector.length) {
      const angles = arcAngles(1, sector.startAngle, sector.endAngle)
      const radius = gapRadius(angles[0])
      points.push({
        key: `element:${sector.ref}`,
        ringRole: sector.ringRole,
        at: polarPoint(radius, angles[0]),
        action: { kind: 'element', sectorId: sector.ref },
        label: `Add element to ${sector.name}`,
      })
      continue
    }
    const angles = ringedArcAngles(onSector.length, sector.startAngle, sector.endAngle, ringIndex)
    for (const gap of elementGapPoints(angles, sector.startAngle, sector.endAngle, false)) {
      const before = onSector[gap.beforeIndex] as (typeof onSector)[number] | undefined
      const radius = gapRadius(gap.angle, [onSector[gap.beforeIndex - 1]?.id, before?.id])
      points.push({
        key: `element:${sector.ref}:${before ? before.id : 'end'}`,
        ringRole: sector.ringRole,
        at: polarPoint(radius, gap.angle),
        action: { kind: 'element', sectorId: sector.ref, beforeId: before?.id },
        label: `Add element to ${sector.name}`,
      })
    }
  }
  const outerRole = outerRoleOf(doc.rings)
  const outerElements = model.elements.filter((e) => e.ringRole === outerRole)
  points.push(...endpointInsertionPoints(outerElements, outerRole))
  return points
}

/** The store call behind a "+": a new sector in its ring, a new element in its sector, or a new endpoint already
 * targeting the outer-ring element it was raised from. */
export function cleanInsertionItem(
  action: CleanInsertionAction,
):
  | { kind: 'sector'; patch: { name: string; ringRole: CleanRingRole } }
  | { kind: 'element'; patch: { name: string; sectorId: string }; beforeId?: string }
  | { kind: 'endpoint'; collection: 'actors' | 'externals'; patch: { name: string; targetId: string } } {
  if (action.kind === 'sector') return { kind: 'sector', patch: { name: 'NewSector', ringRole: action.ringRole } }
  if (action.kind === 'element') return { kind: 'element', patch: { name: 'NewElement', sectorId: action.sectorId }, beforeId: action.beforeId }
  return { kind: 'endpoint', collection: action.collection, patch: { name: action.collection === 'actors' ? 'New actor' : 'New system', targetId: action.targetId } }
}
