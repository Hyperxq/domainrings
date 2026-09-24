import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

export interface Choice<Id extends string> {
  id: Id
  label: string
  description?: string
}

interface ChoiceMenuProps<Id extends string> {
  /** The trigger's content; an icon-only trigger also needs `ariaLabel`. */
  label: ReactNode
  ariaLabel?: string
  choices: readonly Choice<Id>[]
  onChoose: (id: Id) => void
}

/**
 * A button that opens a menu of labelled choices. The menu is `position: fixed` under the trigger, so a scrolling
 * or clipping ancestor (the toolbar, the editor) never cuts it off — which holds only while no ancestor is transformed.
 */
export function ChoiceMenu<Id extends string>({ label, ariaLabel, choices, onChoose }: ChoiceMenuProps<Id>) {
  const [at, setAt] = useState<{ top: number; left: number } | null>(null)
  const root = useRef<HTMLSpanElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const triggerId = useId()
  const menuId = useId()
  const items = () => [...(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]

  useEffect(() => {
    if (!at) return
    items()[0]?.focus()
    const away = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setAt(null)
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [at])

  const open = () => {
    const rect = trigger.current!.getBoundingClientRect()
    setAt({ top: rect.bottom + 4, left: rect.left })
  }
  const close = () => {
    setAt(null)
    trigger.current?.focus()
  }

  return (
    <span ref={root} className="choice">
      <button
        ref={trigger}
        id={triggerId}
        type="button"
        className="text-button choice-trigger"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={!!at}
        aria-controls={at ? menuId : undefined}
        onClick={() => (at ? setAt(null) : open())}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowDown' || at) return
          e.preventDefault()
          open()
        }}
      >
        {label}
      </button>
      {at && (
        <div
          id={menuId}
          role="menu"
          aria-labelledby={triggerId}
          className="island choice-menu"
          style={at}
          onKeyDown={(e) => {
            const list = items()
            const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
            if (step) {
              e.preventDefault()
              const from = list.indexOf(document.activeElement as HTMLButtonElement)
              list[(from + step + list.length) % list.length].focus()
            }
            if (e.key === 'Escape') {
              // The Stage and Toast listen for Escape on the document; closing this menu is all it should do.
              e.stopPropagation()
              close()
            }
            // Not prevented: with focus back on the trigger, the browser's own Tab moves on from there.
            if (e.key === 'Tab') close()
          }}
        >
          {choices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="text-button"
              onClick={() => {
                close()
                onChoose(choice.id)
              }}
            >
              {choice.label}
              {choice.description && <span className="choice-description">{choice.description}</span>}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}
