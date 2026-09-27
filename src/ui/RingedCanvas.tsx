import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode, type Ref } from 'react'
import type { Box } from '../layout/layout'
import { isInwardOrSame } from '../model/rings'
import { keyOnCanvas } from './keys'
import { fitTo, islandInset } from './viewport'
import { gridBackgroundStyle, useElementSize, useViewportInteractions, ZoomControls } from './viewportChrome'

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

/** Which ring (by role, `data-band`/`data-layer`) or specific element/endpoint (`data-ref`) is currently hovered
 * or focused — everything a caller needs to decide which of its own "+" affordances to reveal (`affordanceVisible`,
 * below). Both null when nothing in the diagram has the pointer or focus. */
export interface RingedHover {
  layer: string | null
  ref: string | null
}

const NO_HOVER: RingedHover = { layer: null, ref: null }

/** An insertion point's own "+" shows only while its trigger area has the pointer or keyboard focus (mirrors
 * Hexagonal's own Stage: `visiblePoints = hovered ? points.filter(...) : []`) — a ring/sector "+" while its own
 * ring is hovered/focused (directly, or via one of its own elements, which carry the same `data-layer`); an
 * endpoint "+" (add an actor/external for a specific outer-ring element) only while THAT element itself is
 * hovered/focused, never for the ring as a whole — otherwise every outer element's pair would show at once. */
export function affordanceVisible(point: { ringRole: string; action: { kind: string; targetId?: string } }, hover: RingedHover): boolean {
  if (point.action.kind === 'endpoint') return point.action.targetId === hover.ref
  return point.ringRole === hover.layer
}

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

  // The ring a target belongs to (its own `data-band`/`data-layer`, e.g. the band itself or one of its own
  // elements) and the specific element/endpoint it is (`data-ref`) — same convention as Hexagonal's own
  // `layerOf` (Stage.tsx), generalised with a ref lookup for the per-element endpoint "+"s.
  const layerOf = (target: Element) => target.closest('[data-band]')?.getAttribute('data-band') ?? target.closest('[data-layer]')?.getAttribute('data-layer') ?? null
  const refOf = (target: Element) => target.closest('[data-ref]')?.getAttribute('data-ref') ?? null
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
