import type { LayoutRing } from '../layout/layout'
import type { Shape } from '../model/kinds'

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
