import { useEffect, useRef, useState, type Dispatch, type PointerEvent as ReactPointerEvent, type RefObject, type SetStateAction } from 'react'
import type { Point } from '../layout/layout'
import { Icon } from './Icon'
import { MIN_SCALE, panBy, pinch, zoomAt, type Viewport } from './viewport'

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
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(el)
    return () => observer.disconnect()
    // `ref` is a stable ref object (useRef), never a dependency that itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return size
}

export interface ViewportInteractions {
  /** The raw state ('auto' tracks the caller's own `autoFit` on every render; a concrete `Viewport` is whatever
   * the author last panned/zoomed to) — exposed alongside the resolved `viewport` for a caller (Stage) that
   * itself needs to tell the two apart, e.g. to freeze an 'auto' view before a focus switch. */
  view: 'auto' | Viewport
  viewport: Viewport
  setView: Dispatch<SetStateAction<'auto' | Viewport>>
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
  onPanStart,
}: {
  mainRef: RefObject<HTMLElement | null>
  autoFit: Viewport
  wholeFitScale: number
  fitKey: string
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
  const [fullscreen, setFullscreen] = useState(false)

  const [seenFitKey, setSeenFitKey] = useState(fitKey)
  if (fitKey !== seenFitKey) {
    setSeenFitKey(fitKey)
    setView('auto')
  }

  const viewport = view === 'auto' ? autoFit : view
  // The floor a manual zoom (wheel or button) can reach: never above MIN_SCALE, but never above what fitting the
  // whole diagram itself needs either, so a view already fitted to it never snaps back in.
  const zoomFloor = Math.min(MIN_SCALE, wholeFitScale)

  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    // React's onWheel is passive, so preventDefault (to stop page zoom on pinch) needs a native listener.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      setView(zoomAt(viewport, Math.exp(-delta * 0.0015), { x: e.clientX - rect.left, y: e.clientY - rect.top }, zoomFloor))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport, zoomFloor])

  useEffect(() => {
    if (!fullscreen) return
    const el = mainRef.current
    el?.requestFullscreen?.().catch(() => {})
    const onChange = () => !document.fullscreenElement && setFullscreen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFullscreen(false)
    document.addEventListener('fullscreenchange', onChange)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      document.removeEventListener('keydown', onKey)
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
        // The functional updater is required: the browser can dispatch each finger's pointermove synchronously
        // in the same tick, and React batches both setView calls into one render.
        setView((prev) => pinch(typeof prev === 'string' ? viewport : prev, from, to, zoomFloor))
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
    setView(panBy(viewport, e.clientX - d.x, e.clientY - d.y))
    drag.current = { x: e.clientX, y: e.clientY, panning: true }
  }

  return { view, viewport, setView, zoomFloor, dragging, fullscreen, setFullscreen, panned, onPointerDown, onPointerMove, onPointerUp: liftPointer, onPointerCancel: liftPointer }
}

/** The zoom island's five buttons (out, reset, in, fit, fullscreen) — identical markup Stage's and RingedStage's
 * own JSX both carried before the extraction. */
export function ZoomControls({
  viewport,
  zoomFloor,
  centre,
  setView,
  fullscreen,
  setFullscreen,
}: {
  viewport: Viewport
  zoomFloor: number
  centre: Point
  setView: Dispatch<SetStateAction<'auto' | Viewport>>
  fullscreen: boolean
  setFullscreen: (next: boolean) => void
}) {
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
