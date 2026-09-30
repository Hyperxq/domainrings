import type { LayoutRing } from '../layout/layout'
import { ringElementRadius, titleHalfSpan, TITLE_ARC_PAD } from '../layout/ringed'
import { DOMAIN_TITLE, measure, RING_LABEL, RING_SUBTITLE } from '../layout/text'
import { bandPath, type Shape } from './band'

const SUBTITLE_GAP = 4

/** An arc centred at `centerAngle`, spanning `2 * halfSpan` radians, reading left→right — the path a ringed
 * (Onion/Clean) curved `<textPath>` rides, whether a ring's own title (always centred at the top, 12 o'clock) or
 * Clean's own per-sector wedge label (Decision 4, centred anywhere around the ring, at the wedge's own mid-angle).
 * `M`/`A`, not a closed loop: this path is never painted, only referenced. A ring's own title never leaves the
 * top half, where `M→A` in increasing-angle order already reads left-to-right; a sector name can centre in the
 * BOTTOM half too, where that same order runs backwards (decreasing X), rendering every glyph upside down/mirrored
 * (the reported sector-label garbling at the bottom of the outer ring) — swapping the path's own two ends (and
 * its sweep with them) for a bottom-half centre keeps the rendered text upright wherever it sits. */
export function ringedArcPath(radius: number, centerAngle: number, halfSpan: number): string {
  const at = (angle: number) => `${radius * Math.cos(angle)} ${radius * Math.sin(angle)}`
  const flip = Math.sin(centerAngle) > 0
  const from = flip ? centerAngle + halfSpan : centerAngle - halfSpan
  const to = flip ? centerAngle - halfSpan : centerAngle + halfSpan
  return `M${at(from)}A${radius} ${radius} 0 0 ${flip ? 0 : 1} ${at(to)}`
}

/** A ringed (Onion/Clean) ring's own title, curved along its band's own mid-radius arc (ADR-01: the ringed-only
 * path `Ring` below branches to) — never straight text near the pole, which the next ring's own fill paints over
 * once it pokes past this ring's own curve (the reported "Domain Mod", "MAIN SERVIC" clipping). Sized so its arc
 * length always fits within `TITLE_MAX_SPAN` (`ringOutlines`, layout/ringed.ts, grows the ring to guarantee it). */
function RingedTitle({ ring, inner }: { ring: LayoutRing; inner?: LayoutRing }) {
  const innermost = !inner
  const ref = `layer:${ring.role}`
  const radius = ringElementRadius(ring, inner)
  const halfSpan = titleHalfSpan(measure(ring.title, RING_LABEL) + 2 * TITLE_ARC_PAD, radius)
  const arcId = `ring-title-arc-${ring.role}`
  return (
    <>
      <path id={arcId} d={ringedArcPath(radius, -Math.PI / 2, halfSpan)} fill="none" stroke="none" aria-hidden="true" />
      <text className={innermost ? 'domain-title' : 'ring-label'} data-layer={ring.role} data-ref={ref} fontSize={RING_LABEL.size}>
        <textPath href={`#${arcId}`} xlinkHref={`#${arcId}`} startOffset="50%" textAnchor="middle">
          {ring.title}
        </textPath>
      </text>
    </>
  )
}

export function Ring({ ring, shape, inner, interactive }: { ring: LayoutRing; shape: Shape; inner?: LayoutRing; interactive: boolean }) {
  const innermost = !inner
  const className = `ring ring-${ring.role}`
  const ref = `layer:${ring.role}`
  return (
    <>
      <path
        className={className}
        d={bandPath(shape, ring, inner)}
        fillRule="evenodd"
        data-band={ring.role}
        data-layer={ring.role}
        data-ref={ref}
        tabIndex={interactive ? 0 : undefined}
        role={interactive ? 'group' : undefined}
        aria-label={interactive ? ring.title : undefined}
      />
      {shape === 'circle' ? (
        <RingedTitle ring={ring} inner={inner} />
      ) : (
        <text
          className={innermost ? 'domain-title' : 'ring-label'}
          data-layer={ring.role}
          data-ref={ref}
          x={ring.labelAt.x}
          y={ring.labelAt.y}
          fontSize={innermost ? DOMAIN_TITLE.size : RING_LABEL.size}
        >
          {ring.title}
        </text>
      )}
      {ring.subtitle && (
        <text
          className={`ring-subtitle${innermost ? ' on-domain' : ''}`}
          data-layer={ring.role}
          data-ref={ref}
          x={ring.labelAt.x}
          y={ring.labelAt.y + ((innermost ? DOMAIN_TITLE.size : RING_LABEL.size) + 4) / 2 + SUBTITLE_GAP + RING_SUBTITLE.size / 2 + 2}
          fontSize={RING_SUBTITLE.size}
        >
          {ring.subtitle}
        </text>
      )}
    </>
  )
}
