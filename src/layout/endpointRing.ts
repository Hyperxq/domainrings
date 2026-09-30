import { arcAngles, polarPoint } from '../model/rings'
import type { LayoutRing } from './layout'
import { growUntilFits, noOverlap } from './ringOutlines'
import { endpointLabelHeight, endpointLabelWidth, RINGED_ENDPOINT_DIAMETER, type RingedBox } from './ringedMetrics'

interface RingedEndpointSpec {
  id: string
  name: string
  targetId?: string
}

export interface RingedEndpointPlacement {
  key: string
  ref: string
  kind: 'actor' | 'external'
  name: string
  targetId?: string
  x: number
  y: number
}

/** How far outside the outer ring an actor/external sits — no port/adapter concept exists for either kind. */
const ENDPOINT_GAP = 16

/** Actors and externals share one virtual ring outside the outer ring (REQ-05/REQ-07) — identical placement for
 * Onion and Clean (ADR-01). `outerElements` are the outer ring's own already-placed elements (fixed boxes, at
 * their real radius): an endpoint whose angle happens to land close to one, at the default `ENDPOINT_GAP`, can
 * still clip a wide element's box, so the same `growUntilFits` that sizes a ring against its own elements also
 * grows the endpoint radius against both the outer elements and every other endpoint. Returns the extra reach the
 * endpoint ring needs added to `ringedBounds`, so a fresh document with none pays no bounds cost. `elementAt` finds a
 * lone endpoint's target by id. */
export function endpointLayout(
  actors: readonly RingedEndpointSpec[],
  externals: readonly RingedEndpointSpec[],
  outer: LayoutRing,
  outerElements: readonly RingedBox[] = [],
  elementAt: ReadonlyMap<string, { x: number; y: number }> = new Map(),
): { endpoints: RingedEndpointPlacement[]; extraReach: number } {
  const specs: { item: RingedEndpointSpec; kind: 'actor' | 'external' }[] = [
    ...actors.map((item) => ({ item, kind: 'actor' as const })),
    ...externals.map((item) => ({ item, kind: 'external' as const })),
  ]
  if (!specs.length) return { endpoints: [], extraReach: 0 }
  // A lone endpoint has nothing to spread away from, so it sits on its target's side rather than at a fixed spot.
  const target = specs.length === 1 && specs[0].item.targetId ? elementAt.get(specs[0].item.targetId) : undefined
  const angles = target ? [Math.atan2(target.y, target.x)] : arcAngles(specs.length, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI)
  const radius = growUntilFits(outer.apex + ENDPOINT_GAP, (r) =>
    noOverlap([
      ...angles.map((angle) => ({ ...polarPoint(r, angle), width: RINGED_ENDPOINT_DIAMETER, height: RINGED_ENDPOINT_DIAMETER })),
      ...outerElements,
    ]),
  )
  const endpoints: RingedEndpointPlacement[] = specs.map(({ item, kind }, k) => ({
    key: `endpoint:${item.id}`,
    ref: item.id,
    kind,
    name: item.name,
    targetId: item.targetId,
    ...polarPoint(radius, angles[k]),
  }))
  // Decision 6: the reach a fresh document's bounds need to cover isn't the 8px dot's own radius — it's each
  // endpoint's rendered NAME label, which `render/RingedNodes.tsx`'s `RingedEndpointNode` draws starting just past
  // the dot and running away from the origin (never toward it), plus the label's own half text-height vertically.
  // Missing this let a long name (e.g. "ShippingAdapter") sit mostly outside `ringedBounds`, clipped on export/fit.
  // Decision 8: the label wraps the same as an element's own name, so a long one (e.g. "PaymentGatewayAdapter")
  // reaches outward by its own widest LINE, never its whole unbroken name.
  const labelReach = endpoints.length
    ? Math.max(
        ...endpoints.map((e) => Math.abs(e.x) + RINGED_ENDPOINT_DIAMETER / 2 + 4 + endpointLabelWidth(e.name)),
        ...endpoints.map((e) => Math.abs(e.y) + endpointLabelHeight(e.name) / 2),
      )
    : 0
  return { endpoints, extraReach: Math.max(radius - outer.apex + 12, labelReach - outer.apex) }
}
