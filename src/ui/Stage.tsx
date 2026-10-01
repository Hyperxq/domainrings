import { useEffect, useRef, useState, type Ref } from 'react'
import { insertionItem, insertionPoints, type InsertionPoint } from '../layout/insertion'
import type { LayoutNode } from '../layout/layout'
import type { Point } from '../layout/geometry'
import type { LegendModel } from '../layout/legend'
import { currentHexagon, type MapLayout } from '../layout/map'
import { dependencyChain } from '../model/chain'
import { collectionOf, linkTargets, type LinkChoice } from '../model/links'
import { canLink, crossPortTargets, isCrossTarget, targetsByHexagon } from '../model/linkTargeting'
import type { Destination } from '../model/map'
import type { CollectionKey, Diagram as DiagramModel, DomainType, HexaMap, Wall } from '../model/schema'
import { useMapStore } from '../model/store'
import { MapDiagram } from '../render/Diagram'
import { Affordances, InlineName } from './Affordances'
import { hexIdOf, layerOf, refOf } from './canvasTarget'
import { ExpandToggles, GrowButtons, LinkChip } from './stage/overlays'
import { useCanvasShortcuts } from './stage/useCanvasShortcuts'
import { useHexagonFocus } from './stage/useHexagonFocus'
import { useStageViewport } from './stage/useStageViewport'
import { usePreferencesStore } from './state/preferencesStore'
import { useHistoryStore } from './state/historyStore'
import { useViewStore } from './state/viewStore'
import { gridBackgroundStyle, ZoomControls } from './viewportChrome'

interface StageProps {
  model: MapLayout
  /** The full map — needed only to enumerate cross-hexagon link targets (ADR-02); every other prop already
   * carries what the current hexagon alone needs. */
  map: HexaMap
  /** The hexagon `diagram` is the view of; every point insertion/editing works in belongs to it. */
  hexId: string
  diagram: DiagramModel
  legend: LegendModel
  revision: number
  title: string
  svgRef: Ref<SVGSVGElement>
  /** Removes the element `ref` names; false when it is not a model item (a note, the composition root). */
  onDelete: (ref: string) => boolean
  onLink: (source: string, choice: LinkChoice) => void
  /** The current hexagon's own context display name, for the grow menu's "Hexagon in {context}" choice. */
  contextLabel: string
  /** Grows the map from the current hexagon's given free side, into its own context or a new one (GROW-01). */
  onGrow: (side: Wall, context: Destination) => void
}

const { addItem, updateItem, removeItem } = useMapStore.getState()
const { record } = useHistoryStore.getState()
const NODE_KIND: Record<CollectionKey, LayoutNode['kind']> = {
  domain: 'domainItem',
  useCases: 'useCase',
  ports: 'port',
  adapters: 'adapter',
  actors: 'actor',
  externals: 'external',
}
export function Stage({ model, map, hexId, diagram, legend, revision, title, svgRef, onDelete, onLink, contextLabel, onGrow }: StageProps) {
  const mode = usePreferencesStore((s) => s.mode)
  const highlight = usePreferencesStore((s) => s.highlight)
  const dependents = usePreferencesStore((s) => s.dependents)
  const showGuides = usePreferencesStore((s) => s.guides)
  // The open legend island takes the right column, so the fit leaves it free.
  const legendOpen = usePreferencesStore((s) => s.legendOpen)
  const viewOnly = usePreferencesStore((s) => s.viewOnly)
  const panelOpen = useViewStore((s) => s.editorOpen) && !viewOnly
  const linking = useViewStore((s) => s.linking)
  // True right after growing: the current hexagon's title field is open inline (GROW-02.1).
  const naming = useViewStore((s) => s.growing !== null)
  const onReveal = useViewStore((s) => s.reveal)
  const onToggleExpanded = useViewStore((s) => s.toggleExpanded)
  const onLinking = useViewStore((s) => s.startLinking)
  const onNamed = useViewStore((s) => s.commitGrow)
  const onNamingCancel = useViewStore((s) => s.cancelGrow)
  const hex = currentHexagon(model, hexId)
  const hexModel = hex.model
  const mainRef = useRef<HTMLElement>(null)
  // The first click of a real click/click/dblclick gesture can already flip the current hexagon (via
  // flushSync), so by the time dblclick fires `hexId` no longer reflects what was current when the gesture
  // began. `detail === 1` is a real click's own gesture start (browsers never send 0 or repeat 1), so it is
  // the anchor to remember, not the live `hexId`.
  const gestureAnchorHexId = useRef(hexId)
  // A mousedown moves focus to its target as a browser default action, firing `focus` before `pointerup`/`click`.
  // That focus must not reveal "+" buttons (they would sit under the next press and steal its click/dblclick) —
  // only a real keyboard focus should. `pointerdown`/`pointerup` on the stage bracket every such press.
  const pointerPressed = useRef(false)
  // The layer under the pointer (or keyboard focus); CSS does the highlighting from data-hover on the current [data-hex] group.
  const [hovered, setHovered] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  // hexId records which hexagon the edit started on, so a commit that lands after the current hexagon switches still targets it (ADR-05).
  const [editing, setEditing] = useState<{ id: string; collection: CollectionKey; name: string; at: Point; hexId: string; before: { map: HexaMap; focus: string } } | null>(null)

  const { size, centre, view, viewport, setView, zoomFloor, dragging, fullscreen, setFullscreen, panned, onPointerDown, onPointerMove, onPointerUp, onPointerCancel } = useStageViewport({
    model,
    hex,
    mainRef,
    revision,
    legendOpen,
    panelOpen,
    onPanStart: () => setHovered(null),
  })

  useCanvasShortcuts({ selected, linking, hexId, map, diagram, viewOnly, onDelete, onLinking, setSelected, setHovered })

  // Link mode was started before the switch: nothing may finish it now.
  useEffect(() => {
    if (viewOnly) onLinking(null)
  }, [viewOnly, onLinking])

  const { announcement, focusHexagon } = useHexagonFocus({ hexId, model, mainRef, view, viewport, setView, setSelected, onLinking })

  // Insertion points, selection and editing all work in the current hexagon's own (untranslated) coordinates;
  // toScreen adds its centre once, so every overlay lands at the hexagon's place on the map (ADR-04).
  const toScreen = (p: Point) => ({
    x: (p.x + hex.centre.x - viewport.x) * viewport.scale,
    y: (p.y + hex.centre.y - viewport.y) * viewport.scale,
  })
  // The grow-menu anchors are already in map space (cell centres), unlike hexagon-local insertion points.
  const mapToScreen = (p: Point) => ({ x: (p.x - viewport.x) * viewport.scale, y: (p.y - viewport.y) * viewport.scale })
  const targets = linking ? linkTargets(diagram, linking) : []
  // ADR-02: the ports of another hexagon a link-mode selection can connect to — empty unless `linking` is a port.
  const crossTargets = linking ? crossPortTargets(map, diagram, hexId, linking) : []
  const crossLinkTargets = targetsByHexagon(crossTargets)
  // Only what is drawn can be followed, so the chain ends at the ports of a compact hexagon.
  const chain =
    highlight && !linking && selected ? dependencyChain(map, hexId, selected, new Set(model.hexagons.filter((h) => !h.compact).map((h) => h.id)), dependents ? 'dependents' : 'dependencies') : undefined
  const nameOf = (ref: string) => {
    const collection = collectionOf(diagram, ref)
    const items: { id: string; name: string }[] = collection ? diagram[collection] : []
    return items.find((i) => i.id === ref)?.name ?? ''
  }
  // The "Link to…" chip hangs off the selection's top-right corner, for a selection that has something to link to
  // — either a same-hexagon field target or a cross-hexagon port (ADR-02). A port is laid out twice under one ref
  // (its declaration in the domain and the box on the wall): anchor to the box.
  const linkable =
    selected && !linking && !viewOnly && canLink(map, diagram, hexId, selected)
      ? hexModel.nodes.find((n) => n.ref === selected && n.kind === NODE_KIND[collectionOf(diagram, selected)!])
      : undefined
  const visiblePoints = hovered && !viewOnly ? insertionPoints(hexModel, diagram, mode).filter((p) => p.layer === hovered) : []
  const pick = (point: InsertionPoint, choice?: DomainType) => {
    const { collection, patch } = insertionItem(point.action, choice)
    const before = { map, focus: hexId }
    const id = addItem(hexId, collection, patch)
    setEditing({ id, collection, name: patch.name, at: point.at, hexId, before })
  }
  const revealFrom = (target: Element) => {
    const ref = refOf(target)
    if (ref) onReveal(ref, true)
  }
  // The inline name field sits over the new element once it is laid out, over its "+" until then.
  const editingNode = editing && hexModel.nodes.find((n) => n.ref === editing.id && n.kind === NODE_KIND[editing.collection])

  const width = size.width / viewport.scale
  const height = size.height / viewport.scale

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
        aria-label={title || 'Architecture diagram'}
        onPointerOver={(e) => {
          if (dragging) return
          const target = e.target as Element
          if (hexIdOf(target) !== hexId) return setHovered(null)
          setHovered(layerOf(target))
        }}
        onPointerLeave={(e) => !(e.relatedTarget as Element | null)?.closest?.('[data-plus]') && setHovered(null)}
        onFocus={(e) => !pointerPressed.current && setHovered(layerOf(e.target as Element))}
        onBlur={(e) => !(e.relatedTarget as Element | null)?.closest?.('[data-plus]') && setHovered(null)}
        data-link-mode={linking ? '' : undefined}
        data-emphasis={chain ? (dependents ? 'dependents' : '') : undefined}
        onClick={(e) => {
          if (panned.current) return
          const target = e.target as Element
          // The map link, and every context hull/chip, are inert by handler, not by pointer-events:none (ADR-05):
          // none of them must ever select, focus-switch or reveal. A hull/chip still counts as empty canvas for
          // dismissal, since hulls cover the gaps between hexagons.
          if (target.closest('[data-map-link]')) return
          if (target.closest('[data-hull], [data-chip]')) {
            setSelected(null)
            return onLinking(null)
          }
          if (e.detail === 1) gestureAnchorHexId.current = hexId
          const clickedHexId = hexIdOf(target)
          const ref = target.closest('.node')?.getAttribute('data-ref') ?? null
          // ADR-02: a click on another hexagon's port while linking, when that port is a valid cross-hexagon
          // target, creates the link instead of switching focus — checked before the ordinary focus-switch below.
          if (linking && isCrossTarget(crossTargets, hexId, clickedHexId, ref)) return onLink(linking, { kind: 'link', hexagonId: clickedHexId!, portId: ref! })
          if (clickedHexId && clickedHexId !== hexId) return focusHexagon(clickedHexId)
          if (!linking) return setSelected(ref)
          const hit = targets.find((t) => t.targetRef === ref)
          if (hit) onLink(linking, { kind: 'field', ...hit })
          else onLinking(null)
        }}
        onDoubleClick={(e) => {
          e.preventDefault()
          const target = e.target as Element
          if (target.closest('[data-map-link], [data-hull], [data-chip]')) return
          const clickedHexId = hexIdOf(target)
          if (clickedHexId && clickedHexId !== gestureAnchorHexId.current) {
            focusHexagon(clickedHexId)
            onReveal('hexagon', true)
            return
          }
          revealFrom(target)
        }}
        onKeyDown={(e) => {
          const target = e.target as Element
          const groupId = hexIdOf(target)
          const activation = e.key === 'Enter' || e.key === ' '
          const ref = target.closest('.node')?.getAttribute('data-ref') ?? null
          if (activation && linking && isCrossTarget(crossTargets, hexId, groupId, ref)) {
            e.preventDefault()
            return onLink(linking, { kind: 'link', hexagonId: groupId!, portId: ref! })
          }
          if (activation && groupId && groupId !== hexId) {
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
          crossLinkTargets={crossLinkTargets}
          hovered={highlight ? hovered : null}
          chain={chain}
        />
      </svg>
      {/* Mounted from the start (not just once there is something to say): a screen reader only picks up
          a live region's text changes after it exists, so a region that first appears WITH its text already
          set is never announced. */}
      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>

      <Affordances points={visiblePoints} toScreen={toScreen} onPick={pick} onLayer={setHovered} />
      {!viewOnly && <GrowButtons model={model} hex={hex} scale={viewport.scale} mapToScreen={mapToScreen} title={title} contextLabel={contextLabel} onGrow={onGrow} />}
      <ExpandToggles model={model} currentId={hexId} mapToScreen={mapToScreen} onToggle={onToggleExpanded} />
      {linkable && <LinkChip node={linkable} name={nameOf(linkable.ref)} toScreen={toScreen} onLink={() => onLinking(linkable.ref)} />}
      {editing && (
        <InlineName
          key={editing.id}
          at={toScreen(editingNode ? { x: editingNode.x, y: editingNode.y } : editing.at)}
          initial={editing.name}
          onCommit={(name) => {
            updateItem(editing.hexId, editing.collection, editing.id, { name })
            record(editing.before)
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

      <ZoomControls viewport={viewport} zoomFloor={zoomFloor} centre={centre} setView={setView} fullscreen={fullscreen} setFullscreen={setFullscreen} />
    </main>
  )
}
