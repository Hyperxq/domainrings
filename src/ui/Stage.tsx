import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type Ref } from 'react'
import { flushSync } from 'react-dom'
import { insertionItem, insertionPoints, type InsertionPoint } from '../layout/insertion'
import type { LayoutMode, LayoutNode, Point } from '../layout/layout'
import type { LegendModel } from '../layout/legend'
import { cellCentre, currentHexagon, hexagonBounds, hexagonTitle, type MapLayout } from '../layout/map'
import { collectionOf, linkTargets, type LinkTarget } from '../model/links'
import { freeSides, neighbour, UNTITLED_HEXAGON } from '../model/map'
import type { CollectionKey, Diagram as DiagramModel, DomainType, Wall } from '../model/schema'
import { useMapStore } from '../model/store'
import { MapDiagram } from '../render/Diagram'
import { Affordances, InlineName } from './Affordances'
import { ChoiceMenu } from './ChoiceMenu'
import { Icon } from './Icon'
import { typing } from './keys'
import { contains, fitMap, fitTo, islandInset, MIN_SCALE, panBy, pinch, visibleRect, zoomAt, type Viewport } from './viewport'

/** Lowercase, hyphenated compass names for the grow "+" aria-label ("Add hexagon to the {…} of {title}"). */
const SIDE_NAME: Record<Wall, string> = { e: 'east', se: 'south-east', sw: 'south-west', w: 'west', nw: 'north-west', ne: 'north-east' }

interface StageProps {
  model: MapLayout
  /** The hexagon `diagram` is the view of; every point insertion/editing works in belongs to it. */
  hexId: string
  diagram: DiagramModel
  mode: LayoutMode
  /** Off: hovering still reveals the "+" buttons, but nothing dims, glows or retitles. */
  highlight: boolean
  legend: LegendModel
  revision: number
  title: string
  svgRef: Ref<SVGSVGElement>
  panelOpen: boolean
  /** The open legend island takes the right column, so the fit leaves it free. */
  legendOpen: boolean
  showGuides: boolean
  /** Opens the editor at the card for `ref` (an item id, `composition` or `layer:<role>`); `focus` selects its first field. */
  onReveal: (ref: string, focus: boolean) => void
  /** Removes the element `ref` names; false when it is not a model item (a note, the composition root). */
  onDelete: (ref: string) => boolean
  /** The element being linked while in link mode, null otherwise. */
  linking: string | null
  onLinking: (ref: string | null) => void
  onLink: (source: string, target: LinkTarget) => void
  /** The current hexagon's own context display name, for the grow menu's "Hexagon in {context}" choice. */
  contextLabel: string
  /** Grows the map from the current hexagon's given free side, into its own context or a new one (GROW-01). */
  onGrow: (side: Wall, context: 'same' | 'new') => void
  /** True right after growing: the current hexagon's title field is open inline (GROW-02.1). */
  naming: boolean
  onNamed: (title: string) => void
  onNamingCancel: () => void
}

const GRID = 20
const PAN_SLOP = 3
const { addItem, updateItem, removeItem, setFocus } = useMapStore.getState()
const NODE_KIND: Record<CollectionKey, LayoutNode['kind']> = {
  domain: 'domainItem',
  useCases: 'useCase',
  ports: 'port',
  adapters: 'adapter',
  actors: 'actor',
  externals: 'external',
}
/** Delete and Backspace act on the canvas selection only when no field has the keyboard. */
const keyOnCanvas = (target: EventTarget | null) =>
  target instanceof Element && !typing(target) && (target === document.body || !!target.closest('main.stage'))

/** The layer an element belongs to: its band, or the ring it is drawn in. */
const layerOf = (target: Element) =>
  target.closest('[data-band]')?.getAttribute('data-band') ?? target.closest('[data-layer]')?.getAttribute('data-layer') ?? null

export function Stage({ model, hexId, diagram, mode, highlight, legend, revision, title, svgRef, panelOpen, legendOpen, showGuides, onReveal, onDelete, linking, onLinking, onLink, contextLabel, onGrow, naming, onNamed, onNamingCancel }: StageProps) {
  const hex = currentHexagon(model, hexId)
  const hexModel = hex.model
  const mainRef = useRef<HTMLElement>(null)
  const drag = useRef<{ x: number; y: number; panning: boolean } | null>(null)
  // Active touches on the stage itself, screen coordinates relative to its rect (same frame the wheel handler
  // anchors zoomAt with). A third finger is never added: it neither joins nor disturbs an ongoing pinch.
  const pointers = useRef<Map<number, Point>>(new Map())
  // The first click of a real click/click/dblclick gesture can already flip the current hexagon (via
  // flushSync), so by the time dblclick fires `hexId` no longer reflects what was current when the gesture
  // began. `detail === 1` is a real click's own gesture start (browsers never send 0 or repeat 1), so it is
  // the anchor to remember, not the live `hexId`.
  const gestureAnchorHexId = useRef(hexId)
  // A mousedown moves focus to its target as a browser default action, firing `focus` before `pointerup`/`click`.
  // That focus must not reveal "+" buttons (they would sit under the next press and steal its click/dblclick) —
  // only a real keyboard focus should. `pointerdown`/`pointerup` on the stage bracket every such press.
  const pointerPressed = useRef(false)
  const [size, setSize] = useState({ width: 0, height: 0 })
  // 'auto' follows the diagram bounds, falling back to the current hexagon when the whole map doesn't fit at a
  // usable scale (CANVAS-04); 'whole' always shows every hexagon, at whatever zoom that takes, never falling back
  // (FIT-01); a concrete Viewport is whatever the author panned/zoomed to (ADR-05).
  const [view, setView] = useState<'auto' | 'whole' | Viewport>('auto')
  const [dragging, setDragging] = useState(false)
  // The layer under the pointer (or keyboard focus); CSS does the highlighting from data-hover on the current [data-hex] group.
  const [hovered, setHovered] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  // A press that became a pan ends in a click too; it must not change the selection.
  const panned = useRef(false)
  // hexId records which hexagon the edit started on, so a commit that lands after the current hexagon switches still targets it (ADR-05).
  const [editing, setEditing] = useState<{ id: string; collection: CollectionKey; name: string; at: Point; hexId: string } | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  // A new diagram, or the legend opening or closing, refits (unfreezes a manual viewport back to 'auto') — unlike
  // grow/import/delete, these bump `revision`, so this key alone can never see the map-shape changes FIT-02 covers.
  const fitKey = `${revision}:${legendOpen}`
  const [seenFitKey, setSeenFitKey] = useState(fitKey)
  if (fitKey !== seenFitKey) {
    setSeenFitKey(fitKey)
    setView('auto')
  }

  // Whatever moves the store's focus — a click/keyboard switch (also handled in focusHexagon) or an Undo outside
  // Stage's own handlers — leaves no stale selection or link mode pointing at a hexagon that is no longer current.
  // An effect, not a render-phase update like fitKey above: onLinking sets App's own state, and React disallows
  // updating a different component's state while this one renders.
  useEffect(() => {
    setSelected(null)
    onLinking(null)
    // Deliberately keyed on hexId alone — onLinking is a fresh closure every App render and must not re-fire this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hexId])

  const inset = islandInset(size, panelOpen, legendOpen)
  const effectiveSize = { width: size.width || model.bounds.width, height: size.height || model.bounds.height }
  const autoFit = fitMap(model.bounds, hexagonBounds(hex), effectiveSize.width, effectiveSize.height, inset)
  const wholeFit = fitTo(model.bounds, effectiveSize.width, effectiveSize.height, inset, 0)
  const viewport = view === 'auto' ? autoFit : view === 'whole' ? wholeFit : view
  const centre = { x: size.width / 2, y: size.height / 2 }
  // The floor a manual zoom (wheel or button) can reach: never above MIN_SCALE, but never above what "Fit all"
  // itself needs either, so a view already fitted to the whole map never snaps back in (FIT-01, ADR-05).
  const zoomFloor = Math.min(MIN_SCALE, wholeFit.scale)

  // Grow/import/delete/undo never bump `revision` (ADR-02/ADR-05), so the fitKey reset above can't see them — this
  // tracks the hexagon id set instead. A `Viewport` the author set stays iff every added/removed box is still fully
  // on screen (FIT-02.2); otherwise it — like 'auto', which already tracks live — falls back to 'auto' (FIT-02.3).
  // 'whole' always stays: it recomputes against the new bounds every render, never frozen (FIT-02.1).
  const hexKey = model.hexagons.map((h) => h.id).join(',')
  const [seenHexagons, setSeenHexagons] = useState({ key: hexKey, hexagons: model.hexagons })
  if (hexKey !== seenHexagons.key) {
    const nextIds = new Set(model.hexagons.map((h) => h.id))
    const prevIds = new Set(seenHexagons.hexagons.map((h) => h.id))
    const changed = [...model.hexagons.filter((h) => !prevIds.has(h.id)), ...seenHexagons.hexagons.filter((h) => !nextIds.has(h.id))]
    setSeenHexagons({ key: hexKey, hexagons: model.hexagons })
    if (typeof view !== 'string' && !changed.every((h) => contains(visibleRect(view, effectiveSize, inset), hexagonBounds(h)))) setView('auto')
  }

  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

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
  }, [viewport, zoomFloor])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Esc first leaves link mode, keeping the selection; a second Esc clears it.
      if (e.key === 'Escape' && linking) onLinking(null)
      else if (e.key === 'Escape') {
        setHovered(null)
        setSelected(null)
      }
      if (!selected || linking || !keyOnCanvas(e.target)) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        if (onDelete(selected)) setSelected(null)
      }
      if (e.key.toLowerCase() === 'l' && !e.metaKey && !e.ctrlKey && !e.altKey && linkTargets(diagram, selected).length) {
        e.preventDefault()
        onLinking(selected)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selected, onDelete, linking, onLinking, diagram])

  useEffect(() => {
    if (!linking) return
    // Link mode ends on any press outside the canvas (the hint's own close button ends it too).
    const away = (e: PointerEvent) => !(e.target as Element).closest?.('svg.canvas, .toast') && onLinking(null)
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [linking, onLinking])

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
  }, [fullscreen])

  /** Clears selection, ends link mode, and commits any inline name being typed — the settle-on-switch contract (FOCUS-04). */
  const settleFocusSwitch = () => {
    setSelected(null)
    onLinking(null)
    // InlineName commits on blur with whatever the user has typed so far; forcing it here (rather than waiting for
    // native focus-follows-click) makes the commit deterministic instead of depending on browser/jsdom focus timing.
    const active = document.activeElement
    if (active instanceof HTMLInputElement && active.classList.contains('inline-name')) active.blur()
  }

  /** Makes `id` the current hexagon: settles in-progress work, freezes the view so an oversized-map refit can never
   * follow the switch (ADR-04/CANVAS-04), then — for a keyboard-driven switch — moves focus to the new current
   * hexagon's first tabbable element and announces the change (FOCUS-05). */
  const focusHexagon = (id: string, opts: { moveKeyboardFocus?: boolean } = {}) => {
    settleFocusSwitch()
    // Only 'auto' needs freezing: its current-hexagon fallback (CANVAS-04) would otherwise jump to frame the NEW
    // current hexagon. 'whole' never falls back (FIT-01) and a concrete Viewport is already frozen.
    if (view === 'auto') setView(viewport)
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

  // Insertion points, selection and editing all work in the current hexagon's own (untranslated) coordinates;
  // toScreen adds its centre once, so every overlay lands at the hexagon's place on the map (ADR-04).
  const toScreen = (p: Point) => ({
    x: (p.x + hex.centre.x - viewport.x) * viewport.scale,
    y: (p.y + hex.centre.y - viewport.y) * viewport.scale,
  })
  // The grow-menu anchors are already in map space (cell centres), unlike hexagon-local insertion points.
  const mapToScreen = (p: Point) => ({ x: (p.x - viewport.x) * viewport.scale, y: (p.y - viewport.y) * viewport.scale })
  const growSides = freeSides(model, hex.cell).map((side) => {
    const neighbourCentre = cellCentre(neighbour(hex.cell, side), model.pitch)
    return { side, at: mapToScreen({ x: (hex.centre.x + neighbourCentre.x) / 2, y: (hex.centre.y + neighbourCentre.y) / 2 }) }
  })
  const growChoices = (context: string) => [
    { id: 'same' as const, label: `Hexagon in ${context}` },
    { id: 'new' as const, label: 'Hexagon in a new bounded context' },
  ]
  const targets = linking ? linkTargets(diagram, linking) : []
  const nameOf = (ref: string) => {
    const collection = collectionOf(diagram, ref)
    const items: { id: string; name: string }[] = collection ? diagram[collection] : []
    return items.find((i) => i.id === ref)?.name ?? ''
  }
  // The "Link to…" chip hangs off the selection's top-right corner, for a selection that has something to link to.
  // A port is laid out twice under one ref (its declaration in the domain and the box on the wall): anchor to the box.
  const linkable =
    selected && !linking && linkTargets(diagram, selected).length
      ? hexModel.nodes.find((n) => n.ref === selected && n.kind === NODE_KIND[collectionOf(diagram, selected)!])
      : undefined
  const chipAt = (n: LayoutNode) => {
    const a = ((n.rotation ?? 0) * Math.PI) / 180
    const [c, s] = [Math.abs(Math.cos(a)), Math.abs(Math.sin(a))]
    const corner = toScreen({ x: n.x + (n.width / 2) * c + (n.height / 2) * s, y: n.y - (n.width / 2) * s - (n.height / 2) * c })
    return { left: corner.x, top: corner.y }
  }
  const visiblePoints = hovered ? insertionPoints(hexModel, diagram, mode).filter((p) => p.layer === hovered) : []
  const pick = (point: InsertionPoint, choice?: DomainType) => {
    const { collection, patch } = insertionItem(point.action, choice)
    const id = addItem(hexId, collection, patch)
    setEditing({ id, collection, name: patch.name, at: point.at, hexId })
  }
  const revealFrom = (target: Element) => {
    const ref = target.closest('[data-ref]')?.getAttribute('data-ref')
    if (ref) onReveal(ref, true)
  }
  // The inline name field sits over the new element once it is laid out, over its "+" until then.
  const editingNode = editing && hexModel.nodes.find((n) => n.ref === editing.id && n.kind === NODE_KIND[editing.collection])

  const width = size.width / viewport.scale
  const height = size.height / viewport.scale
  const gridStep = GRID * viewport.scale

  /** A finger lifts (up or cancel, same cleanup either way): dropping out of a pinch hands off to a one-finger
   * pan from the remaining finger's current position, so the diagram never jumps. */
  const liftPointer = (e: ReactPointerEvent<HTMLElement>) => {
    pointerPressed.current = false
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

  return (
    <main
      ref={mainRef}
      className={`stage${dragging ? ' is-dragging' : ''}${fullscreen ? ' is-fullscreen' : ''}`}
      style={{
        backgroundSize: `${gridStep}px ${gridStep}px`,
        backgroundPosition: `${-viewport.x * viewport.scale}px ${-viewport.y * viewport.scale}px`,
      }}
      onPointerDown={(e) => {
        pointerPressed.current = true
        if (e.button !== 0 || (e.target as Element).closest('.island, [data-plus], .inline-name')) return
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
        setHovered(null)
      }}
      onPointerMove={(e) => {
        if (pointers.current.has(e.pointerId)) {
          const rect = e.currentTarget.getBoundingClientRect()
          const point = { x: e.clientX - rect.left, y: e.clientY - rect.top }
          if (pointers.current.size === 2) {
            const [idA, idB] = pointers.current.keys()
            const from: [Point, Point] = [pointers.current.get(idA)!, pointers.current.get(idB)!]
            pointers.current.set(e.pointerId, point)
            const to: [Point, Point] = [pointers.current.get(idA)!, pointers.current.get(idB)!]
            // The functional updater is required: the browser can dispatch each finger's pointermove
            // synchronously in the same tick, and React batches both setView calls into one render, so the
            // second call's `viewport` closure would otherwise be stale relative to the first.
            setView((prev) => pinch(prev ?? viewport, from, to))
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
          // Capturing retargets click and dblclick to the stage, so a press that barely moves stays a click on its element.
          if (Math.hypot(e.clientX - d.x, e.clientY - d.y) <= PAN_SLOP) return
          e.currentTarget.setPointerCapture(e.pointerId)
          d.panning = true
          panned.current = true
          setDragging(true)
          setHovered(null)
        }
        setView(panBy(viewport, e.clientX - d.x, e.clientY - d.y))
        drag.current = { x: e.clientX, y: e.clientY, panning: true }
      }}
      onPointerUp={liftPointer}
      onPointerCancel={liftPointer}
    >
      <svg
        ref={svgRef}
        className="canvas"
        role="figure"
        aria-label={title || 'Architecture diagram'}
        onPointerOver={(e) => {
          if (drag.current?.panning) return
          const target = e.target as Element
          if (target.closest('[data-hex]')?.getAttribute('data-hex') !== hexId) return setHovered(null)
          setHovered(layerOf(target))
        }}
        onPointerLeave={(e) => !(e.relatedTarget as Element | null)?.closest?.('[data-plus]') && setHovered(null)}
        onFocus={(e) => !pointerPressed.current && setHovered(layerOf(e.target as Element))}
        onBlur={(e) => !(e.relatedTarget as Element | null)?.closest?.('[data-plus]') && setHovered(null)}
        data-link-mode={linking ? '' : undefined}
        onClick={(e) => {
          if (panned.current) return
          const target = e.target as Element
          // The map link, and every context hull/chip, are inert by handler, not by pointer-events:none (ADR-05):
          // none of them must ever select, focus-switch or reveal.
          if (target.closest('[data-map-link], [data-hull], [data-chip]')) return
          if (e.detail === 1) gestureAnchorHexId.current = hexId
          const clickedHexId = target.closest('[data-hex]')?.getAttribute('data-hex') ?? null
          if (clickedHexId && clickedHexId !== hexId) return focusHexagon(clickedHexId)
          const ref = target.closest('.node')?.getAttribute('data-ref') ?? null
          if (!linking) return setSelected(ref)
          const hit = targets.find((t) => t.targetRef === ref)
          if (hit) onLink(linking, hit)
          else onLinking(null)
        }}
        onDoubleClick={(e) => {
          e.preventDefault()
          const target = e.target as Element
          if (target.closest('[data-map-link], [data-hull], [data-chip]')) return
          const clickedHexId = target.closest('[data-hex]')?.getAttribute('data-hex') ?? null
          if (clickedHexId && clickedHexId !== gestureAnchorHexId.current) {
            focusHexagon(clickedHexId)
            onReveal('hexagon', true)
            return
          }
          revealFrom(target)
        }}
        onKeyDown={(e) => {
          const target = e.target as Element
          const groupId = target.closest('[data-hex]')?.getAttribute('data-hex')
          if ((e.key === 'Enter' || e.key === ' ') && groupId && groupId !== hexId) {
            e.preventDefault()
            return focusHexagon(groupId, { moveKeyboardFocus: true })
          }
          if (e.key === 'Enter') revealFrom(target)
        }}
        viewBox={size.width ? `${viewport.x} ${viewport.y} ${width} ${height}` : undefined}
      >
        <MapDiagram
          map={model}
          legend={legend}
          showGuides={showGuides}
          focus={hexId}
          selected={selected}
          linkTargets={new Set(targets.map((t) => t.targetRef))}
          hovered={highlight ? hovered : null}
        />
      </svg>
      {/* Mounted from the start (not just once there is something to say): a screen reader only picks up
          a live region's text changes after it exists, so a region that first appears WITH its text already
          set is never announced. */}
      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>

      <Affordances points={visiblePoints} toScreen={toScreen} onPick={pick} onLayer={setHovered} />
      {growSides.map(({ side, at }) => (
        // No `transform` here (e.g. translate to centre): ChoiceMenu's own menu is `position: fixed` under the
        // trigger, whose containing block a transformed ancestor would hijack — the half-button-size offset is
        // baked into left/top instead, matching .plus's own 24px circle.
        <span key={side} className="side-plus" style={{ left: at.x - 12, top: at.y - 12 }}>
          <ChoiceMenu
            label={<Icon name="plus" />}
            ariaLabel={`Add hexagon to the ${SIDE_NAME[side]} of ${title || UNTITLED_HEXAGON}`}
            choices={growChoices(contextLabel)}
            onChoose={(context) => onGrow(side, context)}
          />
        </span>
      ))}
      {linkable && (
        <button type="button" className="link-chip" data-plus="" style={chipAt(linkable)} aria-label={`Link ${nameOf(linkable.ref)} to…`} onClick={() => onLinking(linkable.ref)}>
          Link to…
        </button>
      )}
      {editing && (
        <InlineName
          key={editing.id}
          at={toScreen(editingNode ? { x: editingNode.x, y: editingNode.y } : editing.at)}
          initial={editing.name}
          onCommit={(name) => {
            updateItem(editing.hexId, editing.collection, editing.id, { name })
            setEditing(null)
            onReveal(editing.id, false)
          }}
          onCancel={() => {
            removeItem(editing.hexId, editing.collection, editing.id)
            setEditing(null)
          }}
        />
      )}
      {naming && (
        <InlineName key={`naming:${hexId}`} at={mapToScreen(hex.centre)} initial={diagram.title} label="Hexagon title" emptyCommits onCommit={onNamed} onCancel={onNamingCancel} />
      )}

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
        <button type="button" className="icon-button" aria-label="Fit all" title="Fit all" onClick={() => setView('whole')}>
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
    </main>
  )
}
