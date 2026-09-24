import { useRef, useState } from 'react'
import { DOMAIN_CHOICES, type InsertionPoint } from '../layout/insertion'
import type { Point } from '../layout/layout'
import { DOMAIN_TAGS } from '../layout/tags'
import type { DomainType } from '../model/schema'
import { Icon } from './Icon'

interface AffordancesProps {
  /** The "+" buttons of the hovered or focused layer only. */
  points: InsertionPoint[]
  toScreen: (p: Point) => Point
  onPick: (point: InsertionPoint, choice?: DomainType) => void
  onLayer: (layer: string | null) => void
}

/**
 * The on-canvas "+" buttons: real buttons over the stage, positioned with the viewport, never part of the SVG, so
 * they are never exported and never move the layout. A domain "+" first asks which type to add.
 */
export function Affordances({ points, toScreen, onPick, onLayer }: AffordancesProps) {
  const [asking, setAsking] = useState<InsertionPoint | null>(null)
  const place = (p: Point) => {
    const s = toScreen(p)
    return { left: s.x, top: s.y }
  }
  const choose = (point: InsertionPoint) => {
    if (point.action.kind === 'domainRoot' || point.action.kind === 'domainChild') setAsking(point)
    else onPick(point)
  }
  return (
    <div
      className="affordances"
      data-plus=""
      onPointerLeave={(e) => !(e.relatedTarget as Element | null)?.closest?.('svg.canvas, [data-plus]') && onLayer(null)}
    >
      {points.map((point) => (
        <button
          key={point.key}
          type="button"
          className="plus"
          style={place(point.at)}
          aria-label={point.label}
          title={point.label}
          onPointerEnter={() => onLayer(point.layer)}
          onFocus={() => onLayer(point.layer)}
          onClick={() => choose(point)}
        >
          <Icon name="plus" />
        </button>
      ))}
      {asking && (asking.action.kind === 'domainRoot' || asking.action.kind === 'domainChild') && (
        <div
          className="plus-menu island"
          role="menu"
          aria-label={asking.label}
          style={place(asking.at)}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return
            e.stopPropagation()
            setAsking(null)
          }}
        >
          {DOMAIN_CHOICES[asking.action.kind].map((type) => (
            <button
              key={type}
              type="button"
              role="menuitem"
              className="text-button"
              onClick={() => {
                setAsking(null)
                onPick(asking, type)
              }}
            >
              {DOMAIN_TAGS[type]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface InlineNameProps {
  at: Point
  initial: string
  /** Accessible name of the field; defaults to "Name" for the per-item insertion fields. */
  label?: string
  /** When set, an empty commit (Enter or blur) keeps `initial` instead of removing the element — for a hexagon's
   * own title, which should never vanish on a stray blur the way a small inline item does. */
  emptyCommits?: boolean
  onCommit: (name: string) => void
  onCancel: () => void
}

/** The name field of a just-created element, over its box: Enter commits, Esc undoes, blur commits unless empty
 * (or, with `emptyCommits`, blur/Enter on empty keeps the initial default instead of undoing). */
export function InlineName({ at, initial, label = 'Name', emptyCommits, onCommit, onCancel }: InlineNameProps) {
  const [value, setValue] = useState(initial)
  // Enter or Esc settles once; the blur that follows when the field goes away must not settle again.
  const settled = useRef(false)
  const settle = (commit: boolean) => {
    if (settled.current) return
    settled.current = true
    if (commit && value.trim()) onCommit(value.trim())
    else if (commit && emptyCommits) onCommit(initial)
    else onCancel()
  }
  return (
    <input
      className="inline-name"
      aria-label={label}
      style={{ left: at.x, top: at.y }}
      value={value}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') settle(true)
        if (e.key === 'Escape') {
          e.stopPropagation()
          settle(false)
        }
      }}
      onBlur={() => settle(true)}
    />
  )
}
