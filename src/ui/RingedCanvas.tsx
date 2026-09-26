import { useEffect, useState } from 'react'
import { isInwardOrSame } from '../model/rings'

export interface RingedInsertionPoint {
  key: string
  at: { x: number; y: number }
  label: string
}

const NO_TARGETS = new Set<string>()

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

interface RingedDependElement {
  ref: string
  ringRole: string
  name: string
  x: number
  y: number
}

/** The "Depend on…" gesture (REQ-04/REQ-06): select an element, choose another in the same or a more inward
 * ring; a valid target is marked with `data-link-target` (via the returned `linkTargetRefs`) while linking, and
 * choosing one that is not valid cancels the gesture and reports why via `onReject`, leaving the document
 * unchanged either way. Shared by Onion and Clean (ADR-01) — generic over any laid-out element carrying a
 * `ringRole` (Clean's own is resolved through its sector at layout time, ADR-02, so this hook never needs to
 * know the difference). */
export function useDependGesture({
  elements,
  rings,
  onCreate,
  onReject,
  rejectMessage,
}: {
  elements: readonly RingedDependElement[]
  rings: readonly { role: string }[]
  onCreate: (fromId: string, toId: string) => void
  onReject: (message: string) => void
  rejectMessage: string
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const [linking, setLinking] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (linking) setLinking(false)
      else setSelected(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [linking])

  const selectedElement = selected ? elements.find((e) => e.ref === selected) : undefined
  const validTargets = selectedElement ? elements.filter((e) => e.ref !== selected && isInwardOrSame(rings, selectedElement.ringRole, e.ringRole)) : []
  const linkTargetRefs = linking ? new Set(validTargets.map((e) => e.ref)) : NO_TARGETS

  const clickTarget = (ref: string | null) => {
    if (!ref) {
      setLinking(false)
      setSelected(null)
      return
    }
    if (linking && selected) {
      if (validTargets.some((e) => e.ref === ref)) onCreate(selected, ref)
      else onReject(rejectMessage)
      setLinking(false)
      setSelected(null)
      return
    }
    setSelected(ref)
  }

  return { selected, linking, setLinking, selectedElement, validTargets, linkTargetRefs, clickTarget }
}
