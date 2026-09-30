import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode, type Ref } from 'react'
import type { Box } from '../../layout/layout'
import { layerOf, refOf } from '../canvasTarget'
import { keyOnCanvas } from '../keys'
import { fitTo, islandInset } from '../viewport'
import { gridBackgroundStyle, useElementSize, useViewportInteractions, ZoomControls } from '../viewportChrome'

/** Which ring (by role, `data-band`/`data-layer`) or specific element/endpoint (`data-ref`) is currently hovered
 * or focused — everything a caller needs to decide which of its own "+" affordances to reveal (`affordanceVisible`,
 * below). Both null when nothing in the diagram has the pointer or focus. */
export interface RingedHover {
  layer: string | null
  ref: string | null
}

const NO_HOVER: RingedHover = { layer: null, ref: null }

export interface RingedStageProps {
  /** The diagram's own bounds (`OnionLayoutModel`/`CleanLayoutModel.bounds`) — the one thing `RingedStage` fits
   * to, since neither kind ever has more than one diagram to frame or focus (unlike Hexagonal's multi-hexagon map). */
  bounds: Box
  ariaLabel: string
  svgRef: Ref<SVGSVGElement>
  linking: boolean
  onClick: (e: ReactMouseEvent<SVGSVGElement>) => void
  /** The current canvas selection (`useDependGesture`'s own `selected`) — `null` disarms Delete/Backspace below;
   * `RingedStage` never tracks selection itself (that stays owned by `useDependGesture`, shared with the
   * Depend-on gesture), it only needs to know THAT something is selected to gate the shortcut. */
  selected?: string | null
  /** Removes the current selection (mirrors Hexagonal's own Stage `onDelete`, ADR-01) — fired on Delete/Backspace
   * when something is selected, nothing is being renamed, and link mode isn't active. The caller already has
   * `selected` (it owns `useDependGesture`), so this takes no argument and is responsible for its own undo toast
   * and for clearing the selection afterwards. */
  onDelete?: () => void
  /** Reserves the editor's own column/chip so a fit never tucks the diagram under it (`viewport.ts`'s `islandInset`). */
  panelOpen?: boolean
  /** Reserves the legend's own column when open, for the same reason. */
  legendOpen?: boolean
  /** Rendered inside the `<svg>`, in diagram coordinates — the actual diagram, its "+" affordances and chips. A
   * render prop (not a plain node): the caller filters its own insertion points by the given `RingedHover` (via
   * `affordanceVisible`) before rendering them, since `RingedStage` owns the hover/focus tracking the "+"
   * affordances reveal on — the same layer-hover mechanism Hexagonal's own Stage uses. */
  children: (hover: RingedHover) => ReactNode
  /** Rendered as an HTML sibling of the `<svg>`, in screen coordinates — an `<input>` (e.g. `InlineNameField`)
   * can't live inside an SVG tree the way an SVG-native "+" glyph can. */
  overlay?: ReactNode
}

/** The viewport chrome shared by Onion and Clean (ADR-01) — pan, wheel/pinch zoom, fit-to-screen, fullscreen and
 * the dotted grid background, via `useViewportInteractions` (`viewportChrome.tsx`), shared with Hexagonal's own
 * `Stage` rather than a parallel implementation. A single-bounds, single-diagram version of Hexagonal's own
 * `Stage`: neither kind has more than one diagram to fit, so there is no multi-hexagon framing, growing, or
 * cross-diagram linking to carry over. */
export function RingedStage({ bounds, ariaLabel, svgRef, linking, onClick, selected = null, onDelete, panelOpen = false, legendOpen = false, children, overlay }: RingedStageProps) {
  const mainRef = useRef<HTMLElement>(null)
  // Which ring/element/endpoint currently has the pointer or keyboard focus — drives which "+" affordances
  // `children` reveals (`RingedHover`, `affordanceVisible`). A mousedown moves focus to its target as a browser
  // default action, firing `focus` before `pointerup`/`click`; that focus must not itself reveal affordances
  // (they would sit under the next press and steal its click), only a REAL keyboard focus should — mirrors
  // Hexagonal's own Stage.tsx `pointerPressed` guard.
  const [hover, setHover] = useState<RingedHover>(NO_HOVER)
  const pointerPressed = useRef(false)

  const size = useElementSize(mainRef)
  const inset = islandInset(size, panelOpen, legendOpen)
  const effectiveSize = { width: size.width || bounds.width, height: size.height || bounds.height }
  const wholeFit = fitTo(bounds, effectiveSize.width, effectiveSize.height, inset, 0)
  const autoFit = fitTo(bounds, effectiveSize.width, effectiveSize.height, inset)
  const centre = { x: size.width / 2, y: size.height / 2 }
  // A genuinely different-shaped diagram (new/opened/example file, or a ring growing/shrinking enough to change
  // the bounds' own rounded size) or the legend opening/closing refits — the same "unfreeze back to auto"
  // convention Hexagonal's own Stage uses for its own fitKey.
  const fitKey = `${Math.round(bounds.width)}:${Math.round(bounds.height)}:${legendOpen}`
  const { viewport, setView, zoomFloor, dragging, fullscreen, setFullscreen, panned, onPointerDown, onPointerMove, onPointerUp, onPointerCancel } = useViewportInteractions({
    mainRef,
    autoFit,
    wholeFitScale: wholeFit.scale,
    fitKey,
  })

  // Delete/Backspace act on the selection — mirrors Hexagonal's own Stage.tsx, sharing the same `keyOnCanvas`
  // guard: ignored while a field (the inline rename) has the keyboard, and while linking (a stray Delete during
  // the Depend-on gesture must not remove the very element being linked from).
  useEffect(() => {
    if (!onDelete) return
    const onKey = (e: KeyboardEvent) => {
      if (!selected || linking || !keyOnCanvas(e.target)) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        onDelete()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selected, linking, onDelete])

  const width = size.width / viewport.scale
  const height = size.height / viewport.scale

  const reveal = (target: Element | null) => setHover(target ? { layer: layerOf(target), ref: refOf(target) } : NO_HOVER)

  return (
    <main
      ref={mainRef}
      className={`stage${dragging ? ' is-dragging' : ''}${fullscreen ? ' is-fullscreen' : ''}`}
      style={gridBackgroundStyle(viewport)}
      onPointerDown={(e) => {
        pointerPressed.current = true
        onPointerDown(e)
      }}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => {
        pointerPressed.current = false
        onPointerUp(e)
      }}
      onPointerCancel={(e) => {
        pointerPressed.current = false
        onPointerCancel(e)
      }}
    >
      <svg
        ref={svgRef}
        className="canvas"
        role="figure"
        aria-label={ariaLabel}
        data-link-mode={linking ? '' : undefined}
        onClick={(e) => {
          if (panned.current) return
          onClick(e)
        }}
        onPointerOver={(e) => {
          // Panning churns through elements underneath the pointer; none of that is a real hover. Hovering a "+"
          // itself (or the "Depend on…" chip) must not blank out whatever revealed it — it has no `data-band`/
          // `data-layer`/`data-ref` of its own to resolve.
          if (dragging || (e.target as Element).closest('[data-plus]')) return
          reveal(e.target as Element)
        }}
        onPointerLeave={(e) => !(e.relatedTarget as Element | null)?.closest?.('[data-plus]') && reveal(null)}
        onFocus={(e) => {
          if (pointerPressed.current || (e.target as Element).closest('[data-plus]')) return
          reveal(e.target as Element)
        }}
        onBlur={(e) => !(e.relatedTarget as Element | null)?.closest?.('[data-plus]') && reveal(null)}
        viewBox={size.width ? `${viewport.x} ${viewport.y} ${width} ${height}` : `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
      >
        {children(hover)}
      </svg>
      {overlay}

      <ZoomControls viewport={viewport} zoomFloor={zoomFloor} centre={centre} setView={setView} fullscreen={fullscreen} setFullscreen={setFullscreen} />
    </main>
  )
}
