import type { Point } from './layout'

const ENDPOINT_OFFSET = 40
const ENDPOINT_SPREAD = 14

export interface EndpointInsertionPoint<Role extends string> {
  key: string
  ringRole: Role
  at: Point
  action: { kind: 'endpoint'; collection: 'actors' | 'externals'; targetId: string }
  label: string
}

/** One "+" each for an actor and an external system beside every outer-ring element (REQ-05/REQ-07 — only the
 * outer ring ever offers these) — identical placement math for Onion and Clean (ADR-01): the caller supplies
 * whichever of its own laid-out elements sit on the outer ring. */
export function endpointInsertionPoints<Role extends string>(
  outerElements: readonly { ref: string; name: string; x: number; y: number }[],
  outerRole: Role,
): EndpointInsertionPoint<Role>[] {
  const points: EndpointInsertionPoint<Role>[] = []
  for (const element of outerElements) {
    const reach = Math.hypot(element.x, element.y) || 1
    const dir = { x: element.x / reach, y: element.y / reach }
    const base = { x: element.x + dir.x * ENDPOINT_OFFSET, y: element.y + dir.y * ENDPOINT_OFFSET }
    points.push({
      key: `actor:${element.ref}`,
      ringRole: outerRole,
      at: { x: base.x - ENDPOINT_SPREAD, y: base.y },
      action: { kind: 'endpoint', collection: 'actors', targetId: element.ref },
      label: `Add an actor for ${element.name}`,
    })
    points.push({
      key: `external:${element.ref}`,
      ringRole: outerRole,
      at: { x: base.x + ENDPOINT_SPREAD, y: base.y },
      action: { kind: 'endpoint', collection: 'externals', targetId: element.ref },
      label: `Add an external system for ${element.name}`,
    })
  }
  return points
}
