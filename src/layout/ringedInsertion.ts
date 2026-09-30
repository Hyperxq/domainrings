import type { Point } from './geometry'

const ENDPOINT_OFFSET = 40
const ENDPOINT_SPREAD = 14

export interface EndpointInsertionPoint<Role extends string> {
  key: string
  ringRole: Role
  at: Point
  action: { kind: 'endpoint'; collection: 'actors' | 'externals'; targetId: string }
  label: string
}

export interface ElementGapPoint {
  /** The angle this gap's "+" sits at — the circular midpoint between its two neighbours (two elements, or an
   * element and one of the range's own boundaries). */
  angle: number
  /** Index, into the group's own CURRENT order, of the element the new one should be inserted before. A linear
   * group's own last gap (after its last element) equals the group's length — "append", the same final position
   * `ringedDocument.addElement` already gives with no `beforeId` at all. A circular group never needs that: its
   * own wraparound gap (after the last element) instead names element 0 — inserting before it gives the identical
   * final circular arrangement a literal append would (there is no "first"/"last" on a closed ring), so it never
   * needs its own distinct marker. */
  beforeIndex: number
}

/** One "+" for every gap between neighbouring elements already laid out across a ring's or sector's own angular
 * range (Decision: explicit placement — the author's own order is otherwise always respected, ADR-XX — replacing
 * the old single "append after the last" + every ring/sector used to offer) — needs at least one element; an
 * empty ring/sector keeps its own single "add here" +, computed by the caller (`onionInsertionPoints`/
 * `cleanInsertionPoints`), never by this function.
 *
 * `circular` (Onion's whole ring, a closed circle with no boundary of its own) wraps the last element's own
 * neighbour back to the first, giving exactly as many gaps as elements. A linear range (a Clean sector's own
 * wedge, which starts and ends somewhere specific on its ring) instead treats each of its own two boundaries as
 * a virtual neighbour too, giving one gap more than elements — the only way to offer "insert before the first"/
 * "insert after the last" on a range that, unlike a full circle, actually has a first and a last edge. */
export function elementGapPoints(angles: readonly number[], startAngle: number, endAngle: number, circular: boolean): ElementGapPoint[] {
  const n = angles.length
  if (!n) return []
  const midpoint = (a: number, b: number) => (a + b) / 2
  if (circular) {
    return angles.map((angle, i) => {
      // Elements are evenly spaced (`ringedArcAngles`), so the wraparound neighbour's angle is simply the
      // first element's own angle carried one full turn further — never a circular mean (`crossingMinimization.ts`'s
      // own `circularMean`), which only earns its keep when the two angles being averaged aren't already known to
      // be evenly spaced apart.
      const next = i + 1 < n ? angles[i + 1] : angles[0] + 2 * Math.PI
      return { angle: midpoint(angle, next), beforeIndex: (i + 1) % n }
    })
  }
  const bounds = [startAngle, ...angles, endAngle]
  return bounds.slice(0, -1).map((a, i) => ({ angle: midpoint(a, bounds[i + 1]), beforeIndex: i }))
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
