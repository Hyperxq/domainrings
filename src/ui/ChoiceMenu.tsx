import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

export interface Choice<Id extends string> {
  id: Id
  label: string
  description?: string
  /** Present only on a toggle: the item becomes a `menuitemcheckbox` showing this state. */
  checked?: boolean
  /** Draws the item as a segment (`radio`, with `checked`), a track and knob (`switch`) or an icon button (`action`). Runs of one kind sit together, set apart from the next run. */
  control?: 'radio' | 'switch' | 'action'
  /** The icon an `action` shows beside its label. */
  icon?: IconName
  /** Choices sharing a group sit under one labelled heading, placed where the group's first choice is, set apart from the choices around them. */
  group?: string
  /** A key hint shown at the item's right edge; it only labels the shortcut, the caller binds it. */
  shortcut?: string
  /** Turns the item into a parent: pressing it (or ArrowRight) opens these choices beside it instead of choosing it. */
  submenu?: readonly Choice<Id>[]
}

type MenuAt = { top: number; left?: number; right?: number }

const GAP = 4

/** Below/above the trigger, aligned to its left or right edge — or, for a submenu (`beside`), right/left of its parent
 * item — the first spot that is fully on screen and clear of every `[data-menu-avoid]` element (e.g. the legend),
 * else the first that is merely on screen, else the preferred one. */
function place(trigger: DOMRect, menu: { width: number; height: number }, align: 'start' | 'end', beside = false): MenuAt {
  const spots = beside
    ? [{ top: trigger.top, left: trigger.right + GAP, end: false }, { top: trigger.top, left: trigger.left - menu.width - GAP, end: false }]
    : [false, true].flatMap((above) =>
        (['start', 'end'] as const).map((edge) => ({
          top: above ? trigger.top - menu.height - GAP : trigger.bottom + GAP,
          left: edge === 'start' ? trigger.left : trigger.right - menu.width,
          end: edge === 'end',
        })),
      )
  if (align === 'end' && !beside) spots.sort((a, b) => Number(b.end) - Number(a.end))
  const avoid = [...document.querySelectorAll('[data-menu-avoid]')].map((el) => el.getBoundingClientRect())
  const candidates = spots.map(({ top, left, end }) => {
    const at: MenuAt = end ? { top, right: innerWidth - trigger.right } : { top, left }
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
  /** Keeps the menu open after a toggle (a choice with `checked`) so several can be set in one visit; actions still close it. */
  stayOpen?: boolean
}

/**
 * A button that opens a menu of labelled choices. The menu is `position: fixed` under the trigger, so a scrolling
 * or clipping ancestor (the toolbar, the editor) never cuts it off — which holds only while no ancestor is transformed.
 */
export function ChoiceMenu<Id extends string>({ label, ariaLabel, choices, onChoose, className, align = 'start', onTrigger, autoOpen, onDismiss, stayOpen }: ChoiceMenuProps<Id>) {
  const [at, setAt] = useState<MenuAt | null>(null)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const [sub, setSub] = useState<{ choice: Choice<Id>; parent: HTMLButtonElement; at: MenuAt; anchor: DOMRect } | null>(null)
  const menu = useRef<HTMLDivElement>(null)
  const submenu = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLSpanElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const triggerId = useId()
  const menuId = useId()
  const itemsIn = (el: Element | null) => [...(el?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? [])]

  const chunk = <T,>(list: readonly T[], same: (a: T, b: T) => boolean) =>
    list.reduce<T[][]>((acc, entry) => {
      const last = acc.at(-1)
      if (last && same(last[0], entry)) last.push(entry)
      else acc.push([entry])
      return acc
    }, [])
  const runsOf = (runs: Choice<Id>[][]) =>
    runs.map((run, i) => (
      <Fragment key={run[0].id}>
        {i > 0 && <div role="separator" className="choice-separator" />}
        {run[0].control === 'radio' ? <div role="group" className="segmented">{run.map(item)}</div> : run.map(item)}
      </Fragment>
    ))
  const sectionsOf = (list: readonly Choice<Id>[], idBase: string) =>
    list
      .reduce<Choice<Id>[][]>((acc, entry) => {
        const last = acc.at(-1)
        const home = entry.group === undefined ? (last?.[0].group === undefined ? last : undefined) : acc.find((s) => s[0].group === entry.group)
        if (home) home.push(entry)
        else acc.push([entry])
        return acc
      }, [])
      .map((section) => chunk(section, (a, b) => a.control === b.control))
      .map((runs, i) => {
        const group = runs[0][0].group
        const headingId = `${idBase}-${i}`
        return (
          <Fragment key={runs[0][0].id}>
            {i > 0 && <div role="separator" className="choice-separator" />}
            {group ? (
              <div role="group" aria-labelledby={headingId}>
                <div id={headingId} className="choice-heading">{group}</div>
                {runsOf(runs)}
              </div>
            ) : (
              runsOf(runs)
            )}
          </Fragment>
        )
      })
  const item = (choice: Choice<Id>) => (
    <button
      key={choice.id}
      type="button"
      role={choice.control === 'radio' ? 'menuitemradio' : choice.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={choice.checked}
      tabIndex={-1}
      className={choice.control === 'radio' ? 'segmented-option' : 'text-button'}
      data-control={choice.control}
      aria-haspopup={choice.submenu ? 'menu' : undefined}
      aria-expanded={choice.submenu ? sub?.choice.id === choice.id : undefined}
      onClick={(e) => {
        if (choice.submenu) return openSub(choice, e.currentTarget)
        if (!(stayOpen && choice.checked !== undefined)) close()
        onChoose(choice.id)
      }}
      onKeyDown={(e) => {
        if (choice.submenu && e.key === 'ArrowRight') {
          e.preventDefault()
          openSub(choice, e.currentTarget)
        }
      }}
    >
      {choice.icon && <Icon name={choice.icon} />}
      {choice.label}
      {choice.description && <span className="choice-description">{choice.description}</span>}
      {choice.shortcut && <kbd className="choice-shortcut" aria-hidden="true">{choice.shortcut}</kbd>}
      {choice.control === 'switch' && (
        <span className="switch-track" aria-hidden="true">
          <span className="switch-knob" />
        </span>
      )}
    </button>
  )

  useEffect(() => {
    if (!at) return
    itemsIn(menu.current)[0]?.focus()
    const away = (e: PointerEvent) => !root.current?.contains(e.target as Node) && dismiss()
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [at])

  // Placed in two steps: the preferred spot first, so the menu exists to be measured, then corrected before paint.
  useLayoutEffect(() => {
    if (anchor && menu.current) setAt(place(anchor, menu.current.getBoundingClientRect(), align))
  }, [anchor, align])

  useEffect(() => {
    if (sub) itemsIn(submenu.current)[0]?.focus()
    // Focus moves once, as the submenu appears; the placement step below only repositions it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub?.choice.id])

  useLayoutEffect(() => {
    if (sub && submenu.current) {
      const placed = place(sub.anchor, submenu.current.getBoundingClientRect(), 'start', true)
      if (placed.left !== sub.at.left || placed.top !== sub.at.top) setSub({ ...sub, at: placed })
    }
  }, [sub?.choice.id, sub?.anchor])

  const openSub = (choice: Choice<Id>, parent: HTMLButtonElement) => {
    const anchor = parent.getBoundingClientRect()
    setSub({ choice, parent, anchor, at: { top: anchor.top, left: anchor.right + GAP } })
  }
  const closeSub = () => {
    sub?.parent.focus()
    setSub(null)
  }

  const open = () => {
    const rect = trigger.current!.getBoundingClientRect()
    setAnchor(rect)
    setAt(align === 'end' ? { top: rect.bottom + GAP, right: innerWidth - rect.right } : { top: rect.bottom + GAP, left: rect.left })
  }
  const close = () => {
    setAt(null)
    setSub(null)
    trigger.current?.focus()
  }
  const dismiss = () => {
    setAt(null)
    setSub(null)
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
            const list = itemsIn(e.currentTarget)
            const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
            if (step) {
              e.preventDefault()
              setSub(null)
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
          {sectionsOf(choices, menuId)}
        </div>
      )}
      {at && sub && (
        <div
          ref={submenu}
          role="menu"
          aria-label={sub.choice.label}
          className="island choice-menu"
          style={sub.at}
          onKeyDown={(e) => {
            const list = itemsIn(e.currentTarget)
            const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
            if (step) {
              e.preventDefault()
              list[(list.indexOf(document.activeElement as HTMLButtonElement) + step + list.length) % list.length].focus()
            }
            if (e.key === 'Escape' || e.key === 'ArrowLeft') {
              e.stopPropagation()
              closeSub()
            }
            if (e.key === 'Tab') {
              close()
              onDismiss?.()
            }
          }}
        >
          {sectionsOf(sub.choice.submenu!, `${menuId}-sub`)}
        </div>
      )}
    </span>
  )
}
