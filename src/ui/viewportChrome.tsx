import { useEffect, useLayoutEffect, useRef, useState, type Dispatch, type PointerEvent as ReactPointerEvent, type RefObject, type SetStateAction } from 'react'
import type { Point } from '../layout/geometry'
import { useMapStore } from '../model/store'
import { Icon } from './Icon'
import { useViewStore } from './state/viewStore'
import { useEasedViewport } from './useEasedViewport'
import type { Box } from '../layout/geometry'
import { MIN_SCALE, panBy, panInto, pinch, zoomAt, type Viewport } from './viewport'

type Size = { width: number; height: number }
const sameSize = (a: Size, b: Size) => a.width === b.width && a.height === b.height

/** A press starting on a floating island, a "+" affordance or an inline name field never pans — shared by Stage
 * and RingedStage (ADR-01: neither's chrome differs here). */
const IGNORE_SELECTOR = '.island, [data-plus], .inline-name'
const PAN_SLOP = 3
export const GRID = 20

/** `main`'s dotted grid background, following the viewport exactly as Stage's and RingedStage's own did before
 * the extraction — one origin, so both kinds' grids scroll and zoom identically. */
export function gridBackgroundStyle(viewport: Viewport): { backgroundSize: string; backgroundPosition: string } {
  const gridStep = GRID * viewport.scale
  return {
    backgroundSize: `${gridStep}px ${gridStep}px`,
    backgroundPosition: `${-viewport.x * viewport.scale}px ${-viewport.y * viewport.scale}px`,
  }
}

/** Tracks one element's content box via `ResizeObserver` — the measurement both Stage's and RingedStage's own
 * `size` state made, byte-for-byte, before the extraction. */
export function useElementSize(ref: RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 })
  // Layout effect: ResizeObserver reports after the first paint, which would show the diagram fitted to a
  // placeholder size for a frame before snapping to the real one.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setSize({ width, height })
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(el)
    return () => observer.disconnect()
    // `ref` is a stable ref object (useRef), never a dependency that itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return size
}

/** While the editor panel is open, an 'auto' view is frozen instead of refitting around the panel (which snaps the
 * canvas when an element is revealed): as it is when `interest` still shows in the area the panel leaves, else panned
 * the least that brings it there, and only refitted when it cannot fit at the current zoom. Closing the panel restores
 * 'auto' unless the author has panned or zoomed since — the frozen object's identity tells. A resize drops a frozen view
 * back to 'auto', which fits the new size around the panel. A map change that moves something off screen still drops a
 * frozen view back to 'auto' (FIT-02.2), as for any manual view.
 * `viewport` is the view to freeze, normally the interactions' `heading`. `visible` is the diagram box the NEW free area shows under the current view. Called from the stage's own render:
 * the update below is a render-phase one. */
export function useFreezeWhilePanelOpen({
  panelOpen,
  view,
  viewport,
  setView,
  visible,
  interest,
  size,
}: {
  panelOpen: boolean
  view: 'auto' | Viewport
  viewport: Viewport
  setView: Dispatch<SetStateAction<'auto' | Viewport>>
  visible: Box
  interest: Box
  size: Size
}) {
  const [seen, setSeen] = useState({ panelOpen, frozen: null as Viewport | null, size })
  const toggled = panelOpen !== seen.panelOpen
  if (!toggled && sameSize(size, seen.size)) return
  let frozen = seen.frozen
  if (!toggled) {
    if (frozen && view === frozen) {
      setView('auto')
      frozen = null
    }
  } else if (panelOpen) {
    frozen = view === 'auto' ? panInto(viewport, visible, interest) : null
    if (frozen) setView(frozen)
  } else {
    if (frozen && view === frozen) setView('auto')
    frozen = null
  }
  setSeen({ panelOpen, frozen, size })
}

export interface ViewportInteractions {
  /** The raw state ('auto' tracks the caller's own `autoFit` on every render; a concrete `Viewport` is whatever
   * the author last panned/zoomed to) — exposed alongside the resolved `viewport` for a caller (Stage) that
   * itself needs to tell the two apart, e.g. to freeze an 'auto' view before a focus switch. */
  view: 'auto' | Viewport
  viewport: Viewport
  /** Where the view was last heading, for freezing it: unlike `viewport` it is never a frame partway through an ease. */
  heading: RefObject<Viewport>
  setView: Dispatch<SetStateAction<'auto' | Viewport>>
  /** Moves the view to `next` with the same ease as a refit, unlike `setView`, which lands at once (a pan or zoom must track the pointer). */
  flyTo: (next: Viewport) => void
  zoomFloor: number
  dragging: boolean
  fullscreen: boolean
  setFullscreen: (next: boolean) => void
  /** Whether the just-finished press panned or pinched — a caller's `onClick` must skip acting when it did. */
  panned: RefObject<boolean>
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void
}

/** Pan, wheel/pinch zoom, fit-to-screen and fullscreen — the viewport chrome shared by Hexagonal's `Stage` and
 * Onion/Clean's `RingedStage` (ADR-01), extracted so a fix to one never silently misses the other. Callers keep
 * their own `autoFit`/`fitKey` logic (Stage's is multi-hexagon aware; RingedStage's is a single bounds), since
 * that part genuinely differs; this hook owns only the pan/zoom/fullscreen mechanics on top of it. */
export function useViewportInteractions({
  mainRef,
  autoFit,
  wholeFitScale,
  fitKey,
  size,
  snapKey = '',
  onPanStart,
}: {
  mainRef: RefObject<HTMLElement | null>
  autoFit: Viewport
  wholeFitScale: number
  fitKey: string
  /** The stage's size: a change snaps the view to its fit instead of easing, and a manual view keeps its centre. */
  size?: Size
  /** A change snaps the view to its fit like a resize does: a different document is not a fit to watch. */
  snapKey?: string
  /** Fires the instant a press becomes a real pan or pinch (not a plain click) — Stage clears its hovered layer here. */
  onPanStart?: () => void
}): ViewportInteractions {
  const drag = useRef<{ x: number; y: number; panning: boolean } | null>(null)
  // Active touches on the stage itself, screen coordinates relative to its rect (same frame the wheel handler
  // anchors zoomAt with). A third finger is never added: it neither joins nor disturbs an ongoing pinch.
  const pointers = useRef<Map<number, Point>>(new Map())
  const panned = useRef(false)
  const [view, setView] = useState<'auto' | Viewport>('auto')
  const [dragging, setDragging] = useState(false)
  const fullscreen = useViewStore((s) => s.fullscreen)
  const setFullscreen = useViewStore((s) => s.setFullscreen)

  const [seenFitKey, setSeenFitKey] = useState(fitKey)
  if (fitKey !== seenFitKey) {
    setSeenFitKey(fitKey)
    setView('auto')
  }

  const fitRequest = useViewStore((s) => s.fitRequest)
  const [seenFitRequest, setSeenFitRequest] = useState(fitRequest)
  if (fitRequest !== seenFitRequest) {
    setSeenFitRequest(fitRequest)
    setView('auto')
  }

  // Render-phase, like the fitKey reset: a manual view keeps the content under its centre as the stage resizes. Not for
  // the first measurement, when there was no stage to centre on.
  const [seenSize, setSeenSize] = useState(size)
  if (size && seenSize && !sameSize(size, seenSize)) {
    setSeenSize(size)
    if (seenSize.width && seenSize.height)
      setView((v) => (v === 'auto' ? v : { ...v, x: v.x - (size.width - seenSize.width) / 2 / v.scale, y: v.y - (size.height - seenSize.height) / 2 / v.scale }))
  }

  // The views `flyTo` set: identity marks them, so any later pan or zoom (a new object) is a manual view again.
  const flights = useRef(new WeakSet<Viewport>())
  const flyTo = (next: Viewport) => {
    flights.current.add(next)
    setView(next)
  }
  // Only an 'auto' view or a flight eases: a manual view is the author's own pan/zoom and must track the pointer exactly.
  const { viewport, heading } = useEasedViewport(view === 'auto' ? autoFit : view, view === 'auto' || flights.current.has(view), `${size?.width}x${size?.height}:${snapKey}`)
  // The floor a manual zoom (wheel or button) can reach: never above MIN_SCALE, but never above what fitting the
  // whole diagram itself needs either, so a view already fitted to it never snaps back in.
  const zoomFloor = Math.min(MIN_SCALE, wholeFitScale)

  // Wheel, pinch and pan events arrive faster than frames: each composes onto `pending` (the view the last event
  // asked for, which no render has shown yet) and one setView per animation frame commits it.
  const latest = useRef({ viewport, zoomFloor })
  const pending = useRef<Viewport | null>(null)
  const frame = useRef(0)
  useLayoutEffect(() => {
    latest.current = { viewport, zoomFloor }
    pending.current = null
  }, [viewport, zoomFloor])
  useEffect(() => () => cancelAnimationFrame(frame.current), [])
  const queueView = (next: (from: Viewport, zoomFloor: number) => Viewport) => {
    pending.current = next(pending.current ?? latest.current.viewport, latest.current.zoomFloor)
    frame.current ||= requestAnimationFrame(() => {
      frame.current = 0
      if (pending.current) setView(pending.current)
    })
  }
  // The wheel listener is attached once; it reaches the changing parts through `queueView`'s refs.
  const queueRef = useRef(queueView)
  queueRef.current = queueView

  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    // React's onWheel is passive, so preventDefault (to stop page zoom on pinch) needs a native listener.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      queueRef.current((from, floor) => zoomAt(from, Math.exp(-delta * 0.0015), { x: e.clientX - rect.left, y: e.clientY - rect.top }, floor))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!fullscreen) return
    // The root, not the stage: the panels and the zoom island live outside it and would vanish. A refusal drops the
    // flag, or the toolbar would stay hidden in a fullscreen that never happened.
    if (!document.documentElement.requestFullscreen) return void setFullscreen(false)
    document.documentElement.requestFullscreen().catch(() => setFullscreen(false))
    const onChange = () => !document.fullscreenElement && setFullscreen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFullscreen(false)
    document.addEventListener('fullscreenchange', onChange)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      document.removeEventListener('keydown', onKey)
      setFullscreen(false)
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreen])

  /** A finger lifts (up or cancel, same cleanup either way): dropping out of a pinch hands off to a one-finger
   * pan from the remaining finger's current position, so the diagram never jumps. */
  const liftPointer = (e: ReactPointerEvent<HTMLElement>) => {
    if (!pointers.current.has(e.pointerId)) return
    const wasPinching = pointers.current.size === 2
    pointers.current.delete(e.pointerId)
    if (wasPinching && pointers.current.size === 1) {
      const rect = e.currentTarget.getBoundingClientRect()
      const [remaining] = pointers.current.values()
      drag.current = { x: remaining.x + rect.left, y: remaining.y + rect.top, panning: true }
      return
    }
    drag.current = null
    setDragging(false)
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.target as Element).closest(IGNORE_SELECTOR)) return
    if (pointers.current.size >= 2) return // a third finger never joins the gesture
    const wasEmpty = pointers.current.size === 0
    const rect = e.currentTarget.getBoundingClientRect()
    pointers.current.set(e.pointerId, { x: e.clientX - rect.left, y: e.clientY - rect.top })
    if (wasEmpty) {
      panned.current = false
      drag.current = { x: e.clientX, y: e.clientY, panning: false }
      return
    }
    // The second finger turns this into a pinch: it never selects, links, or counts as a click.
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = null
    panned.current = true
    setDragging(true)
    onPanStart?.()
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (pointers.current.has(e.pointerId)) {
      const rect = e.currentTarget.getBoundingClientRect()
      const point = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      if (pointers.current.size === 2) {
        const [idA, idB] = pointers.current.keys()
        const from: [Point, Point] = [pointers.current.get(idA)!, pointers.current.get(idB)!]
        pointers.current.set(e.pointerId, point)
        const to: [Point, Point] = [pointers.current.get(idA)!, pointers.current.get(idB)!]
        // Each finger's pointermove is its own event; queueing composes them onto the same pending view.
        queueView((v, floor) => pinch(v, from, to, floor))
        return
      }
      pointers.current.set(e.pointerId, point)
    }
    const d = drag.current
    if (!d) return
    if (!(e.buttons & 1)) {
      drag.current = null
      return
    }
    if (!d.panning) {
      // Capturing retargets click (and dblclick, for Stage) to the stage, so a press that barely moves stays a
      // click on its element.
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) <= PAN_SLOP) return
      e.currentTarget.setPointerCapture(e.pointerId)
      d.panning = true
      panned.current = true
      setDragging(true)
      onPanStart?.()
    }
    const [dx, dy] = [e.clientX - d.x, e.clientY - d.y]
    queueView((v) => panBy(v, dx, dy))
    drag.current = { x: e.clientX, y: e.clientY, panning: true }
  }

  return { view, viewport, heading, setView, flyTo, zoomFloor, dragging, fullscreen, setFullscreen, panned, onPointerDown, onPointerMove, onPointerUp: liftPointer, onPointerCancel: liftPointer }
}

/** The zoom island's buttons (out, reset, in, fit, view only, fullscreen, plus expand and collapse all when the map can
 * compact) — identical markup Stage's and RingedStage's own JSX both carried before the extraction. */
export function ZoomControls({
  canExpandAll,
  viewport,
  zoomFloor,
  centre,
  setView,
  fullscreen,
  setFullscreen,
}: {
  /** Only a map large enough to compact has hexagons to expand; a ringed stage never does. */
  canExpandAll?: boolean
  viewport: Viewport
  zoomFloor: number
  centre: Point
  setView: Dispatch<SetStateAction<'auto' | Viewport>>
  fullscreen: boolean
  setFullscreen: (next: boolean) => void
}) {
  const expandAll = (expand: boolean) => useViewStore.getState().expandAll(expand ? useMapStore.getState().map.hexagons.map((h) => h.id) : [])
  return (
    <div className="island zoom" role="group" aria-label="Zoom">
      <button type="button" className="icon-button" aria-label="Zoom out" title="Zoom out" onClick={() => setView(zoomAt(viewport, 1 / 1.2, centre, zoomFloor))}>
        <Icon name="minus" />
      </button>
      <button type="button" className="zoom-level" aria-label="Reset zoom to 100%" title="Reset zoom" onClick={() => setView(zoomAt(viewport, 1 / viewport.scale, centre, zoomFloor))}>
        {Math.round(viewport.scale * 100)}%
      </button>
      <button type="button" className="icon-button" aria-label="Zoom in" title="Zoom in" onClick={() => setView(zoomAt(viewport, 1.2, centre, zoomFloor))}>
        <Icon name="plus" />
      </button>
      <button type="button" className="icon-button" aria-label="Fit diagram to screen" title="Fit to screen" onClick={() => setView('auto')}>
        <Icon name="fit" />
      </button>
      {canExpandAll && (
        <>
          <span className="divider" aria-hidden="true" />
          <button type="button" className="icon-button" aria-label="Expand all" title="Show every hexagon in full" onClick={() => expandAll(true)}>
            <Icon name="hexagonPlus" />
          </button>
          <button type="button" className="icon-button" aria-label="Collapse all" title="Show only the current hexagon in full" onClick={() => expandAll(false)}>
            <Icon name="hexagonMinus" />
          </button>
          <span className="divider" aria-hidden="true" />
        </>
      )}
      <button
        type="button"
        className="icon-button"
        aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        aria-pressed={fullscreen}
        title={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
        onClick={() => setFullscreen(!fullscreen)}
      >
        <Icon name={fullscreen ? 'shrink' : 'expand'} />
      </button>
    </div>
  )
}
