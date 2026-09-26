import type { LayoutRing } from '../layout/layout'

/** Ring geometry the shared `<Ring>` primitive can draw: 'hexagon' for a Hexagonal map's layout, 'circle' for
 * Onion's (ADR-01) — independent of the (now hexagonal-only) architecture-kind config in model/kinds. */
export type Shape = 'hexagon' | 'circle'

function outline(shape: Shape, r: Pick<LayoutRing, 'halfWidth' | 'straight' | 'apex'>): string {
  if (shape === 'circle') {
    const c = r.halfWidth
    return `M${c} 0A${c} ${c} 0 1 0 ${-c} 0A${c} ${c} 0 1 0 ${c} 0Z`
  }
  const { halfWidth: w, straight: h, apex: a } = r
  return `M0 ${-a}L${w} ${-h}L${w} ${h}L0 ${a}L${-w} ${h}L${-w} ${-h}Z`
}

/** A ring's own band: its outline minus the next inner ring's, drawn with fill-rule evenodd. */
export const bandPath = (shape: Shape, ring: LayoutRing, inner?: LayoutRing) =>
  inner ? `${outline(shape, ring)}${outline(shape, inner)}` : outline(shape, ring)

/** One radial line per sector boundary angle (REQ-08) — from the inner ring's own edge (or the centre, for the
 * innermost ring) out to this ring's own edge, so N sectors show as N wedge divisions. A ring with 0 or 1 sector
 * has nothing to divide (the caller passes an empty `boundaryAngles` list), a no-op this function accepts. */
export function sectorDividers(ring: Pick<LayoutRing, 'apex'>, inner: Pick<LayoutRing, 'apex'> | undefined, boundaryAngles: readonly number[]): string {
  const innerRadius = inner ? inner.apex : 0
  return boundaryAngles
    .map((angle) => {
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      return `M${innerRadius * cos} ${innerRadius * sin}L${ring.apex * cos} ${ring.apex * sin}`
    })
    .join('')
}
