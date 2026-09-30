import type { RingedHover } from './RingedStage'

export interface RingedInsertionPoint {
  key: string
  at: { x: number; y: number }
  label: string
}

/** A ring/sector/endpoint "+", drawn as a plain SVG glyph — shared by Onion and Clean (ADR-01): neither has
 * pan/zoom, so there is no screen/diagram coordinate split to bridge; every affordance lives in the same SVG. */
export function PlusGlyph({ point, onPick }: { point: RingedInsertionPoint; onPick: () => void }) {
  return (
    <g
      className="ringed-plus"
      data-plus=""
      transform={`translate(${point.at.x} ${point.at.y})`}
      tabIndex={0}
      role="button"
      aria-label={point.label}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        onPick()
      }}
    >
      <circle r={10} />
      <line x1={-5} y1={0} x2={5} y2={0} />
      <line x1={0} y1={-5} x2={0} y2={5} />
    </g>
  )
}

/** The "Depend on…" chip offered above a selected element with at least one valid target — shared by Onion and
 * Clean (ADR-01): both stages render it identically, positioned off the element it was invoked from. */
export function DependChip({ x, y, name, onLink }: { x: number; y: number; name: string; onLink: () => void }) {
  return (
    <g
      className="ringed-depend-chip"
      data-plus=""
      transform={`translate(${x} ${y - 26})`}
      tabIndex={0}
      role="button"
      aria-label={`Depend on… from ${name}`}
      onClick={(e) => {
        e.stopPropagation()
        onLink()
      }}
    >
      <rect x={-38} y={-11} width={76} height={22} rx={11} />
      <text x={0} y={0} dominantBaseline="middle" textAnchor="middle">Depend on…</text>
    </g>
  )
}

/** The inline rename field a fresh element's "+" opens immediately — shared by Onion and Clean (ADR-01): Enter
 * commits (via blur), Escape and an empty-name blur both cancel (the caller decides what cancelling means, e.g.
 * removing the just-created element). */
export function InlineNameField({
  defaultValue,
  onCommit,
  onCancel,
}: {
  defaultValue: string
  onCommit: (name: string) => void
  onCancel: () => void
}) {
  return (
    <input
      className="inline-name ringed-inline-name"
      aria-label="element name"
      autoFocus
      defaultValue={defaultValue}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          e.stopPropagation()
          onCancel()
        }
      }}
      onBlur={(e) => {
        const name = e.currentTarget.value.trim()
        if (name) onCommit(name)
        else onCancel()
      }}
    />
  )
}

/** An insertion point's own "+" shows only while its trigger area has the pointer or keyboard focus (mirrors
 * Hexagonal's own Stage: `visiblePoints = hovered ? points.filter(...) : []`) — a ring/sector "+" while its own
 * ring is hovered/focused (directly, or via one of its own elements, which carry the same `data-layer`); an
 * endpoint "+" (add an actor/external for a specific outer-ring element) only while THAT element itself is
 * hovered/focused, never for the ring as a whole — otherwise every outer element's pair would show at once. */
export function affordanceVisible(point: { ringRole: string; action: { kind: string; targetId?: string } }, hover: RingedHover): boolean {
  if (point.action.kind === 'endpoint') return point.action.targetId === hover.ref
  return point.ringRole === hover.layer
}
