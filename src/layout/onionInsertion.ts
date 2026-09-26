import { outerRoleOf, ringCircumferencePositions } from '../model/rings'
import type { OnionFile, OnionRingRole } from '../model/schema'
import type { Point } from './layout'
import type { OnionLayoutModel } from './onion'
import { endpointInsertionPoints } from './ringedInsertion'

/** What a "+" creates (REQ-07, REQ-05) — the position of the "+" decides which ring, or which outer element an
 * endpoint targets. Onion has no port/adapter concept, so this never grows the Hexagonal `InsertionAction` union. */
export type OnionInsertionAction = { kind: 'element'; ringRole: OnionRingRole } | { kind: 'endpoint'; collection: 'actors' | 'externals'; targetId: string }

export interface OnionInsertionPoint {
  key: string
  /** The ring whose hover reveals this "+" — always the outer ring for an endpoint action. */
  ringRole: OnionRingRole
  at: Point
  action: OnionInsertionAction
  label: string
}

/** One "+" per ring, at the circumference slot its next element would take (REQ-07); one "+" each for an actor
 * and an external system beside every outer-ring element (REQ-05 — only the outer ring ever offers these, via
 * the shared `endpointInsertionPoints`, ADR-01). */
export function onionInsertionPoints(model: OnionLayoutModel, doc: OnionFile): OnionInsertionPoint[] {
  const points: OnionInsertionPoint[] = []
  doc.rings.forEach((ring, i) => {
    const count = doc.elements.filter((e) => e.ringRole === ring.role).length
    const at = ringCircumferencePositions(count + 1, model.rings[i])[count]
    points.push({ key: `element:${ring.role}`, ringRole: ring.role, at, action: { kind: 'element', ringRole: ring.role }, label: `Add an element to ${ring.name}` })
  })
  const outerRole = outerRoleOf(doc.rings)
  const outerElements = model.elements.filter((e) => e.ringRole === outerRole)
  points.push(...endpointInsertionPoints(outerElements, outerRole))
  return points
}

/** The store call behind a "+": a new element in its ring, or a new endpoint already targeting the outer-ring
 * element it was raised from. */
export function onionInsertionItem(
  action: OnionInsertionAction,
): { kind: 'element'; patch: { name: string; ringRole: OnionRingRole } } | { kind: 'endpoint'; collection: 'actors' | 'externals'; patch: { name: string; targetId: string } } {
  if (action.kind === 'element') return { kind: 'element', patch: { name: 'NewElement', ringRole: action.ringRole } }
  return { kind: 'endpoint', collection: action.collection, patch: { name: action.collection === 'actors' ? 'New actor' : 'New system', targetId: action.targetId } }
}
