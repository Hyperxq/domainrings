import { useEffect, useRef, useState, type Ref } from 'react'
import { insertionItem, insertionPoints, type InsertionPoint } from '../layout/insertion'
import type { LayoutMode, LayoutModel, LayoutNode, Point } from '../layout/layout'
import type { LegendModel } from '../layout/legend'
import { collectionOf, linkTargets, type LinkTarget } from '../model/links'
import type { CollectionKey, Diagram as DiagramModel, DomainType } from '../model/schema'
import { useDiagramStore } from '../model/store'
import { Diagram } from '../render/Diagram'
import { Affordances, InlineName } from './Affordances'
import { Icon } from './Icon'
import { typing } from './keys'
import { fitTo, islandInset, panBy, zoomAt, type Viewport } from './viewport'

interface StageProps {
  model: LayoutModel
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
}

const GRID = 20
const PAN_SLOP = 3
const { addItem, updateItem, removeItem } = useDiagramStore.getState()
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

export function Stage({ model, diagram, mode, highlight, legend, revision, title, svgRef, panelOpen, legendOpen, showGuides, onReveal, onDelete, linking, onLinking, onLink }: StageProps) {
  const mainRef = useRef<HTMLElement>(null)
  const drag = useRef<{ x: number; y: number; panning: boolean } | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  // null means "fitted": the viewport follows the diagram bounds until the user pans or zooms.
  const [view, setView] = useState<Viewport | null>(null)
  const [dragging, setDragging] = useState(false)
  // The layer under the pointer (or keyboard focus); CSS does the highlighting from data-hover on the svg.
  const [hovered, setHovered] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  // A press that became a pan ends in a click too; it must not change the selection.
  const panned = useRef(false)
  const [editing, setEditing] = useState<{ id: string; collection: CollectionKey; name: string; at: Point } | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  // A new diagram, or the legend opening or closing, refits.
  const fitKey = `${revision}:${legendOpen}`
  const [seenFitKey, setSeenFitKey] = useState(fitKey)
  if (fitKey !== seenFitKey) {
    setSeenFitKey(fitKey)
    setView(null)
  }

  const viewport = view ?? fitTo(model.bounds, size.width || model.bounds.width, size.height || model.bounds.height, islandInset(size, panelOpen, legendOpen))
  const centre = { x: size.width / 2, y: size.height / 2 }

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
      setView(zoomAt(viewport, Math.exp(-delta * 0.0015), { x: e.clientX - rect.left, y: e.clientY - rect.top }))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [viewport])

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

  const toScreen = (p: Point) => ({ x: (p.x - viewport.x) * viewport.scale, y: (p.y - viewport.y) * viewport.scale })
  const targets = linking ? linkTargets(diagram, linking) : []
  const nameOf = (ref: string) => {
    const collection = collectionOf(diagram, ref)
    const items: { id: string; name: string }[] = collection ? diagram[collection] : []
    return items.find((i) => i.id === ref)?.name ?? ''
  }
  // The "Link to…" chip hangs off the selection's top-right corner, for a selection that has something to link to.
  const linkable = selected && !linking && linkTargets(diagram, selected).length ? model.nodes.find((n) => n.ref === selected) : undefined
  const chipAt = (n: LayoutNode) => {
    const a = ((n.rotation ?? 0) * Math.PI) / 180
    const [c, s] = [Math.abs(Math.cos(a)), Math.abs(Math.sin(a))]
    const corner = toScreen({ x: n.x + (n.width / 2) * c + (n.height / 2) * s, y: n.y - (n.width / 2) * s - (n.height / 2) * c })
    return { left: corner.x, top: corner.y }
  }
  const visiblePoints = hovered ? insertionPoints(model, diagram, mode).filter((p) => p.layer === hovered) : []
  const pick = (point: InsertionPoint, choice?: DomainType) => {
    const { collection, patch } = insertionItem(point.action, choice)
    const id = addItem(collection, patch)
    setEditing({ id, collection, name: patch.name, at: point.at })
  }
  const revealFrom = (target: Element) => {
    const ref = target.closest('[data-ref]')?.getAttribute('data-ref')
    if (ref) onReveal(ref, true)
  }
  // The inline name field sits over the new element once it is laid out, over its "+" until then.
  const editingNode = editing && model.nodes.find((n) => n.ref === editing.id && n.kind === NODE_KIND[editing.collection])

  const width = size.width / viewport.scale
  const height = size.height / viewport.scale
  const gridStep = GRID * viewport.scale

  return (
    <main
      ref={mainRef}
      className={`stage${dragging ? ' is-dragging' : ''}${fullscreen ? ' is-fullscreen' : ''}`}
      style={{
        backgroundSize: `${gridStep}px ${gridStep}px`,
        backgroundPosition: `${-viewport.x * viewport.scale}px ${-viewport.y * viewport.scale}px`,
      }}
      onPointerDown={(e) => {
        panned.current = false
        if (e.button !== 0 || (e.target as Element).closest('.island, [data-plus], .inline-name')) return
        drag.current = { x: e.clientX, y: e.clientY, panning: false }
      }}
      onPointerMove={(e) => {
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
      onPointerUp={() => {
        drag.current = null
        setDragging(false)
      }}
      onPointerCancel={() => {
        drag.current = null
        setDragging(false)
      }}
    >
      <svg
        ref={svgRef}
        className="canvas"
        role="figure"
        aria-label={title || 'Architecture diagram'}
        data-hover={highlight ? (hovered ?? undefined) : undefined}
        onPointerOver={(e) => {
          if (drag.current?.panning) return
          setHovered(layerOf(e.target as Element))
        }}
        onPointerLeave={(e) => !(e.relatedTarget as Element | null)?.closest?.('[data-plus]') && setHovered(null)}
        onFocus={(e) => setHovered(layerOf(e.target as Element))}
        onBlur={(e) => !(e.relatedTarget as Element | null)?.closest?.('[data-plus]') && setHovered(null)}
        data-link-mode={linking ? '' : undefined}
        onClick={(e) => {
          if (panned.current) return
          const ref = (e.target as Element).closest('.node')?.getAttribute('data-ref') ?? null
          if (!linking) return setSelected(ref)
          const hit = targets.find((t) => t.targetRef === ref)
          if (hit) onLink(linking, hit)
          else onLinking(null)
        }}
        onDoubleClick={(e) => {
          e.preventDefault()
          revealFrom(e.target as Element)
        }}
        onKeyDown={(e) => e.key === 'Enter' && revealFrom(e.target as Element)}
        viewBox={size.width ? `${viewport.x} ${viewport.y} ${width} ${height}` : undefined}
      >
        <Diagram model={model} legend={legend} showGuides={showGuides} selected={selected} linkTargets={new Set(targets.map((t) => t.targetRef))} />
      </svg>

      <Affordances points={visiblePoints} toScreen={toScreen} onPick={pick} onLayer={setHovered} />
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
            updateItem(editing.collection, editing.id, { name })
            setEditing(null)
            onReveal(editing.id, false)
          }}
          onCancel={() => {
            removeItem(editing.collection, editing.id)
            setEditing(null)
          }}
        />
      )}

      <div className="island zoom" role="group" aria-label="Zoom">
        <button type="button" className="icon-button" aria-label="Zoom out" title="Zoom out" onClick={() => setView(zoomAt(viewport, 1 / 1.2, centre))}>
          <Icon name="minus" />
        </button>
        <button type="button" className="zoom-level" aria-label="Reset zoom to 100%" title="Reset zoom" onClick={() => setView(zoomAt(viewport, 1 / viewport.scale, centre))}>
          {Math.round(viewport.scale * 100)}%
        </button>
        <button type="button" className="icon-button" aria-label="Zoom in" title="Zoom in" onClick={() => setView(zoomAt(viewport, 1.2, centre))}>
          <Icon name="plus" />
        </button>
        <button type="button" className="icon-button" aria-label="Fit diagram to screen" title="Fit to screen" onClick={() => setView(null)}>
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
