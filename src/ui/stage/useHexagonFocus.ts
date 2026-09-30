import { useEffect, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { flushSync } from 'react-dom'
import { currentHexagon, hexagonTitle, type MapLayout } from '../../layout/map'
import { useMapStore } from '../../model/store'
import type { Viewport } from '../viewport'

const { setFocus } = useMapStore.getState()

/** Switching the current hexagon: settles in-progress work, and clears the selection and link mode whenever the
 * store's focus moves, however it moved. */
export function useHexagonFocus({
  hexId,
  model,
  mainRef,
  view,
  viewport,
  setView,
  setSelected,
  onLinking,
}: {
  hexId: string
  model: MapLayout
  mainRef: RefObject<HTMLElement | null>
  view: 'auto' | Viewport
  viewport: Viewport
  setView: (view: 'auto' | Viewport) => void
  setSelected: Dispatch<SetStateAction<string | null>>
  onLinking: (ref: string | null) => void
}) {
  const [announcement, setAnnouncement] = useState('')

  // Whatever moves the store's focus — a click/keyboard switch (also handled in focusHexagon) or an Undo outside
  // Stage's own handlers — leaves no stale selection or link mode pointing at a hexagon that is no longer current.
  // An effect, not a render-phase update like fitKey below: onLinking sets App's own state, and React disallows
  // updating a different component's state while this one renders.
  useEffect(() => {
    setSelected(null)
    onLinking(null)
    // Deliberately keyed on hexId alone — onLinking is a fresh closure every App render and must not re-fire this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hexId])

  /** Clears selection, ends link mode, and commits any inline name being typed — the settle-on-switch contract (FOCUS-04). */
  const settleFocusSwitch = () => {
    setSelected(null)
    onLinking(null)
    // InlineName commits on blur with whatever the user has typed so far; forcing it here (rather than waiting for
    // native focus-follows-click) makes the commit deterministic instead of depending on browser/jsdom focus timing.
    const active = document.activeElement
    if (active instanceof HTMLInputElement && active.classList.contains('inline-name')) active.blur()
  }

  /** Makes `id` the current hexagon: settles in-progress work, freezes the view on a single-hexagon map so its
   * current-hexagon fallback (CANVAS-04) can't jump to frame the new current hexagon, then — for a keyboard-driven
   * switch — moves focus to the new current hexagon's first tabbable element and announces the change (FOCUS-05).
   * On 2+ hexagons 'auto' IS the whole-map fit (FIT-01), which never depends on which hexagon is current, so
   * freezing there would only turn a following view into a stuck one (FIT-02.1). */
  const focusHexagon = (id: string, opts: { moveKeyboardFocus?: boolean } = {}) => {
    settleFocusSwitch()
    if (view === 'auto' && model.hexagons.length < 2) setView(viewport)
    flushSync(() => setFocus(id))
    if (opts.moveKeyboardFocus) {
      setAnnouncement(`${hexagonTitle(currentHexagon(model, id).model)} is now the current hexagon`)
      const group = mainRef.current?.querySelector<SVGGElement>(`[data-hex="${CSS.escape(id)}"]`)
      // The outer ring is also tabbable and comes first in DOM order; REQ-05.1 wants the first ITEM instead,
      // falling back to whatever is tabbable when the hexagon has no items at all.
      const target = group?.querySelector<HTMLElement | SVGElement>('.node[tabindex]') ?? group?.querySelector<HTMLElement | SVGElement>('[tabindex]')
      target?.focus()
    }
  }

  return { announcement, focusHexagon }
}
