import { arcAngles, outerRoleOf, polarPoint, ringedArcAngles } from '../model/rings'
import type { OnionFile, OnionRingRole } from '../model/schema'
import type { Point } from './layout'
import type { OnionLayoutModel } from './onion'
import { elementGapPoints, endpointInsertionPoints } from './ringedInsertion'
import { ringSlotRadii } from './ringed'

const FULL_CIRCLE = { start: -Math.PI / 2, end: -Math.PI / 2 + 2 * Math.PI }

/** What a "+" creates (REQ-07, REQ-05) — the position of the "+" decides which ring, or which outer element an
 * endpoint targets; `beforeId`, only ever set on a gap between two real neighbours, names which existing element
 * the new one should land before (REQ: insert-at-position, `ringedDocument.addElement`) — absent, it appends,
 * exactly like the single "+" an empty ring still offers. Onion has no port/adapter concept, so this never grows
 * the Hexagonal `InsertionAction` union. */
export type OnionInsertionAction = { kind: 'element'; ringRole: OnionRingRole; beforeId?: string } | { kind: 'endpoint'; collection: 'actors' | 'externals'; targetId: string }

export interface OnionInsertionPoint {
  key: string
  /** The ring whose hover reveals this "+" — always the outer ring for an endpoint action. */
  ringRole: OnionRingRole
  at: Point
  action: OnionInsertionAction
  label: string
}

/** One "+" in every gap between two neighbouring elements already on a ring's own circumference, circular (its
 * last element's own neighbour wraps back to the first — a whole ring has no boundary of its own, REQ-07); one
 * "+" for an empty ring instead, at the one slot a first element would take. The document's own author order is
 * never reshuffled here (that's now `tidyOnionOrder`'s own explicit job) — every angle matches exactly where
 * `layoutOnion`'s real elements sit (`ringedArcAngles`), so a gap's "+" always lands between the actual boxes it
 * names, never a hypothetical re-spaced slot. One "+" each for an actor and an external system beside every
 * outer-ring element (REQ-05 — only the outer ring ever offers these, via the shared `endpointInsertionPoints`,
 * ADR-01). */
export function onionInsertionPoints(model: OnionLayoutModel, doc: OnionFile): OnionInsertionPoint[] {
  const points: OnionInsertionPoint[] = []
  doc.rings.forEach((ring, i) => {
    const onRing = doc.elements.filter((e) => e.ringRole === ring.role)
    const inner = model.rings[i - 1]
    if (!onRing.length) {
      const angles = arcAngles(1, FULL_CIRCLE.start, FULL_CIRCLE.end)
      const radius = ringSlotRadii(model.rings[i], inner, angles)[0]
      points.push({
        key: `element:${ring.role}`,
        ringRole: ring.role,
        at: polarPoint(radius, angles[0]),
        action: { kind: 'element', ringRole: ring.role },
        label: `Add an element to ${ring.name}`,
      })
      return
    }
    const angles = ringedArcAngles(onRing.length, FULL_CIRCLE.start, FULL_CIRCLE.end, i)
    for (const gap of elementGapPoints(angles, FULL_CIRCLE.start, FULL_CIRCLE.end, true)) {
      const radius = ringSlotRadii(model.rings[i], inner, [gap.angle])[0]
      const before = onRing[gap.beforeIndex]
      points.push({
        key: `element:${ring.role}:${before.id}`,
        ringRole: ring.role,
        at: polarPoint(radius, gap.angle),
        action: { kind: 'element', ringRole: ring.role, beforeId: before.id },
        label: `Add an element to ${ring.name}`,
      })
    }
  })
  const outerRole = outerRoleOf(doc.rings)
  const outerElements = model.elements.filter((e) => e.ringRole === outerRole)
  points.push(...endpointInsertionPoints(outerElements, outerRole))
  return points
}

/** The store call behind a "+": a new element in its ring (at the gap's own position, `beforeId`, when the action
 * carries one), or a new endpoint already targeting the outer-ring element it was raised from. */
export function onionInsertionItem(
  action: OnionInsertionAction,
):
  | { kind: 'element'; patch: { name: string; ringRole: OnionRingRole }; beforeId?: string }
  | { kind: 'endpoint'; collection: 'actors' | 'externals'; patch: { name: string; targetId: string } } {
  if (action.kind === 'element') return { kind: 'element', patch: { name: 'NewElement', ringRole: action.ringRole }, beforeId: action.beforeId }
  return { kind: 'endpoint', collection: action.collection, patch: { name: action.collection === 'actors' ? 'New actor' : 'New system', targetId: action.targetId } }
}
