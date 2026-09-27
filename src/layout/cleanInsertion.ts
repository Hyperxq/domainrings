import { arcAngles, outerRoleOf, polarPoint, ringedArcAngles } from '../model/rings'
import type { CleanFile, CleanRingRole } from '../model/schema'
import type { Point } from './layout'
import type { CleanLayoutModel } from './clean'
import { elementGapPoints, endpointInsertionPoints } from './ringedInsertion'
import { ringElementRadius, ringSlotRadii } from './ringed'

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
    // ring's own title always centres at the TOP (-π/2), so the bottom is where a "+" at this same mid-band
    // radius stays clear of it.
    const radius = ringElementRadius(model.rings[i], model.rings[i - 1])
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
    if (!onSector.length) {
      const angles = arcAngles(1, sector.startAngle, sector.endAngle)
      const radius = ringSlotRadii(ring, inner, angles)[0]
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
      const radius = ringSlotRadii(ring, inner, [gap.angle])[0]
      const before = onSector[gap.beforeIndex] as (typeof onSector)[number] | undefined
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
