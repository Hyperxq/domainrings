import { useEffect, useRef, useState, type Ref } from 'react'
import { insertionItem, insertionPoints, type InsertionPoint } from '../layout/insertion'
import type { LayoutMode, LayoutModel, LayoutNode, Point } from '../layout/layout'
import type { LegendModel } from '../layout/legend'
import type { CollectionKey, Diagram as DiagramModel, DomainType } from '../model/schema'
import { useDiagramStore } from '../model/store'
import { Diagram } from '../render/Diagram'
import { Affordances, InlineName } from './Affordances'
import { Icon } from './Icon'
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
  showGuides: boolean
  /** Opens the editor at the card for `ref` (an item id, `composition` or `layer:<role>`); `focus` selects its first field. */
  onReveal: (ref: string, focus: boolean) => void
}

const GRID = 20
const { addItem, updateItem, removeItem } = useDiagramStore.getState()
const NODE_KIND: Record<CollectionKey, LayoutNode['kind']> = {
  domain: 'domainItem',
  useCases: 'useCase',
  ports: 'port',
  adapters: 'adapter',
  actors: 'actor',
  externals: 'external',
}
/** The layer an element belongs to: its band, or the ring it is drawn in. */
const layerOf = (target: Element) =>
  target.closest('[data-band]')?.getAttribute('data-band') ?? target.closest('[data-layer]')?.getAttribute('data-layer') ?? null

export function Stage({ model, diagram, mode, highlight, legend, revision, title, svgRef, panelOpen, showGuides, onReveal }: StageProps) {
  const mainRef = useRef<HTMLElement>(null)
  const drag = useRef<{ x: number; y: number } | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  // null means "fitted": the viewport follows the diagram bounds until the user pans or zooms.
  const [view, setView] = useState<Viewport | null>(null)
  const [dragging, setDragging] = useState(false)
  // The layer under the pointer (or keyboard focus); CSS does the highlighting from data-hover on the svg.
  const [hovered, setHovered] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; collection: CollectionKey; name: string; at: Point } | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [seenRevision, setSeenRevision] = useState(revision)
  if (revision !== seenRevision) {
    setSeenRevision(revision)
    setView(null)
  }

  const viewport = view ?? fitTo(model.bounds, size.width || model.bounds.width, size.height || model.bounds.height, islandInset(size, panelOpen))
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
    const clear = (e: KeyboardEvent) => e.key === 'Escape' && setHovered(null)
    document.addEventListener('keydown', clear)
    return () => document.removeEventListener('keydown', clear)
  }, [])

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
        // The second press of a double-click never starts a pan.
        if (e.button !== 0 || e.detail > 1 || (e.target as Element).closest('.island, [data-plus], .inline-name')) return
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { x: e.clientX, y: e.clientY }
        setDragging(true)
        setHovered(null)
      }}
      onPointerMove={(e) => {
        if (!drag.current) return
        setView(panBy(viewport, e.clientX - drag.current.x, e.clientY - drag.current.y))
        drag.current = { x: e.clientX, y: e.clientY }
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
          if (drag.current) return
          setHovered(layerOf(e.target as Element))
        }}
        onPointerLeave={(e) => !(e.relatedTarget as Element | null)?.closest?.('[data-plus]') && setHovered(null)}
        onFocus={(e) => setHovered(layerOf(e.target as Element))}
        onBlur={(e) => !(e.relatedTarget as Element | null)?.closest?.('[data-plus]') && setHovered(null)}
        onDoubleClick={(e) => {
          e.preventDefault()
          revealFrom(e.target as Element)
        }}
        onKeyDown={(e) => e.key === 'Enter' && revealFrom(e.target as Element)}
        viewBox={size.width ? `${viewport.x} ${viewport.y} ${width} ${height}` : undefined}
      >
        <Diagram model={model} legend={legend} showGuides={showGuides} />
      </svg>

      <Affordances points={visiblePoints} toScreen={toScreen} onPick={pick} onLayer={setHovered} />
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
