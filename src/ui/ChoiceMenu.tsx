import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export interface Choice<Id extends string> {
  id: Id
  label: string
  description?: string
  /** Present only on a toggle: the item becomes a `menuitemcheckbox` showing this state. */
  checked?: boolean
}

type MenuAt = { top: number; left?: number; right?: number }

const GAP = 4

/** Below/above the trigger, aligned to its left or right edge — the first spot that is fully on screen and clear of
 * every `[data-menu-avoid]` element (e.g. the legend), else the first that is merely on screen, else the preferred one. */
function place(trigger: DOMRect, menu: { width: number; height: number }, align: 'start' | 'end'): MenuAt {
  const spots = [false, true].flatMap((above) => (['start', 'end'] as const).map((edge) => ({ above, edge })))
  if (align === 'end') spots.sort((a, b) => Number(b.edge === 'end') - Number(a.edge === 'end'))
  const avoid = [...document.querySelectorAll('[data-menu-avoid]')].map((el) => el.getBoundingClientRect())
  const candidates = spots.map(({ above, edge }) => {
    const top = above ? trigger.top - menu.height - GAP : trigger.bottom + GAP
    const left = edge === 'start' ? trigger.left : trigger.right - menu.width
    const at: MenuAt = edge === 'start' ? { top, left } : { top, right: innerWidth - trigger.right }
    const onScreen = top >= 0 && left >= 0 && top + menu.height <= innerHeight && left + menu.width <= innerWidth
    const clear = avoid.every((a) => left >= a.right || left + menu.width <= a.left || top >= a.bottom || top + menu.height <= a.top)
    return { at, onScreen, clear }
  })
  return (candidates.find((c) => c.onScreen && c.clear) ?? candidates.find((c) => c.onScreen) ?? candidates[0]).at
}

interface ChoiceMenuProps<Id extends string> {
  /** The trigger's content; an icon-only trigger also needs `ariaLabel`. */
  label: ReactNode
  ariaLabel?: string
  choices: readonly Choice<Id>[]
  onChoose: (id: Id) => void
  className?: string
  /** `end` aligns the menu's right edge with the trigger's, for a trigger near the viewport's right edge. */
  align?: 'start' | 'end'
  /** Runs instead of opening the menu when the trigger is pressed — for a trigger whose own action comes first. */
  onTrigger?: () => void
  /** Opens the menu as soon as it turns true, for a menu the caller decides to show. */
  autoOpen?: boolean
  /** Called when the menu closes without a choice (Escape, Tab, an outside press, or the trigger again). */
  onDismiss?: () => void
}

/**
 * A button that opens a menu of labelled choices. The menu is `position: fixed` under the trigger, so a scrolling
 * or clipping ancestor (the toolbar, the editor) never cuts it off — which holds only while no ancestor is transformed.
 */
export function ChoiceMenu<Id extends string>({ label, ariaLabel, choices, onChoose, className, align = 'start', onTrigger, autoOpen, onDismiss }: ChoiceMenuProps<Id>) {
  const [at, setAt] = useState<MenuAt | null>(null)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const menu = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLSpanElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const triggerId = useId()
  const menuId = useId()
  const items = () => [...(root.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? [])]

  useEffect(() => {
    if (!at) return
    items()[0]?.focus()
    const away = (e: PointerEvent) => !root.current?.contains(e.target as Node) && dismiss()
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [at])

  // Placed in two steps: the preferred spot first, so the menu exists to be measured, then corrected before paint.
  useLayoutEffect(() => {
    if (anchor && menu.current) setAt(place(anchor, menu.current.getBoundingClientRect(), align))
  }, [anchor, align])

  const open = () => {
    const rect = trigger.current!.getBoundingClientRect()
    setAnchor(rect)
    setAt(align === 'end' ? { top: rect.bottom + GAP, right: innerWidth - rect.right } : { top: rect.bottom + GAP, left: rect.left })
  }
  const close = () => {
    setAt(null)
    trigger.current?.focus()
  }
  const dismiss = () => {
    setAt(null)
    onDismiss?.()
  }
  useEffect(() => {
    if (autoOpen) open()
    // Opens on the flag turning true only; `open` reads the trigger's rect at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen])

  return (
    <span ref={root} className="choice">
      <button
        ref={trigger}
        id={triggerId}
        type="button"
        className={className ? `text-button choice-trigger ${className}` : 'text-button choice-trigger'}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={!!at}
        aria-controls={at ? menuId : undefined}
        onClick={() => (onTrigger ? onTrigger() : at ? dismiss() : open())}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowDown' || at) return
          e.preventDefault()
          if (onTrigger) onTrigger()
          else open()
        }}
      >
        {label}
      </button>
      {at && (
        <div
          ref={menu}
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
              onDismiss?.()
            }
            // Not prevented: with focus back on the trigger, the browser's own Tab moves on from there.
            if (e.key === 'Tab') {
              close()
              onDismiss?.()
            }
          }}
        >
          {choices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              role={choice.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
              aria-checked={choice.checked}
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
