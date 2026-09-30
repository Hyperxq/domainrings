import { useState, type ReactNode } from 'react'
import { Icon } from './Icon'

const SECTIONS_KEY = 'domainrings:editor-sections'

function readSections(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? '{}')
  } catch {
    return {}
  }
}

interface FoldProps {
  id: string
  title: string
  count?: number
  /** Buttons over the summary row's right end, such as the section's "+". */
  actions?: ReactNode
  children: ReactNode
}

/** A collapsible editor section, open by default; each one remembers whether it was left open — shared with
 * OnionEditor (its own sections follow the same fold/remember-state convention, not a parallel one). */
export function Fold({ id, title, count, actions, children }: FoldProps) {
  const [open, setOpen] = useState(() => readSections()[id] ?? true)
  const settle = (next: boolean) => {
    setOpen(next)
    try {
      localStorage.setItem(SECTIONS_KEY, JSON.stringify({ ...readSections(), [id]: next }))
    } catch {
      // The section still toggles for this session.
    }
  }
  const headingId = `section-${id}`
  return (
    <section className="section" aria-labelledby={headingId}>
      {/* Outside the summary: a button nested in it would be interactive content inside a toggle. */}
      {actions && <span className="section-actions">{actions}</span>}
      {/* The click settles synchronously; toggle only catches opens from outside, such as revealInEditor. */}
      <details className="fold" open={open} onToggle={(e) => e.currentTarget.open !== open && settle(e.currentTarget.open)}>
        <summary
          className="section-head"
          onClick={(e) => {
            e.preventDefault()
            settle(!open)
          }}
        >
          <Icon name="chevron" />
          <h2 id={headingId}>{title}</h2>
          {count !== undefined && <span className="count">· {count}</span>}
        </summary>
        {children}
      </details>
    </section>
  )
}
