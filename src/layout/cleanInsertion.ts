import { arcPositions, outerRoleOf, ringCircumferencePositions } from '../model/rings'
import type { CleanFile, CleanRingRole } from '../model/schema'
import type { Point } from './layout'
import type { CleanLayoutModel } from './clean'
import { endpointInsertionPoints } from './ringedInsertion'

/** What a "+" creates (REQ-03, REQ-04, REQ-07) — a ring's own "+" adds a sector to it; a sector's own "+" adds an
 * element to it (never directly to a ring, REQ-04); an outer-ring element's "+"s add an actor/external. */
export type CleanInsertionAction =
  | { kind: 'sector'; ringRole: CleanRingRole }
  | { kind: 'element'; sectorId: string }
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
    const [at] = ringCircumferencePositions(1, model.rings[i])
    points.push({ key: `sector:${ring.role}`, ringRole: ring.role, at, action: { kind: 'sector', ringRole: ring.role }, label: `Add sector to ${ring.name}` })
  })
  for (const sector of model.sectors) {
    const ring = model.rings.find((r) => r.role === sector.ringRole)!
    const count = doc.elements.filter((e) => e.sectorId === sector.ref).length
    const at = arcPositions(count + 1, ring, sector.startAngle, sector.endAngle)[count]
    points.push({ key: `element:${sector.ref}`, ringRole: sector.ringRole, at, action: { kind: 'element', sectorId: sector.ref }, label: `Add element to ${sector.name}` })
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
  | { kind: 'element'; patch: { name: string; sectorId: string } }
  | { kind: 'endpoint'; collection: 'actors' | 'externals'; patch: { name: string; targetId: string } } {
  if (action.kind === 'sector') return { kind: 'sector', patch: { name: 'NewSector', ringRole: action.ringRole } }
  if (action.kind === 'element') return { kind: 'element', patch: { name: 'NewElement', sectorId: action.sectorId } }
  return { kind: 'endpoint', collection: action.collection, patch: { name: action.collection === 'actors' ? 'New actor' : 'New system', targetId: action.targetId } }
}
