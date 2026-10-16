import { useEffect, useMemo, useRef, useState, type CSSProperties, type Ref } from 'react'
import { canCompact } from '../layout/compactHexagon'
import { translatedNodeBox } from '../layout/linkEnds'
import { insertionItem, insertionPoints, type InsertionPoint } from '../layout/insertion'
import type { LayoutNode } from '../layout/layout'
import type { Point } from '../layout/geometry'
import type { LegendModel } from '../layout/legend'
import { currentHexagon, type MapLayout } from '../layout/map'
import { dependencyChain, unionChain } from '../model/chain'
import { flowChain, flowOf } from '../model/flow'
import { collectionOf, linkTargets, type LinkChoice } from '../model/links'
import { noteToShow, notesOf } from '../model/notes'
import { plannedOf } from '../model/planned'
import { canLink, crossPortTargets, isCrossTarget, targetsByHexagon } from '../model/linkTargeting'
import { diagramOf, type Destination } from '../model/map'
import type { CollectionKey, Diagram as DiagramModel, DomainType, HexaMap, Wall } from '../model/schema'
import { useMapStore } from '../model/store'
import { MapDiagram } from '../render/Diagram'
import { Affordances, InlineName } from './Affordances'
import { hexIdOf, hullIdOf, layerOf, nodeRefOf, refOf, threadsOf } from './canvasTarget'
import { useInspectedFlow } from './FlowInspector'
import { StepCard, usePresentation } from './PresentPanel'
import { NotePopover } from './stage/NotePopover'
import { BoxLabels, ContextReveals, ExpandToggles, GrowButtons, HexagonTitles, LinkChip, MapTitle, mapTitleOverlaid, titlesOverlaid, zoomLevel } from './stage/overlays'
import { useCanvasShortcuts } from './stage/useCanvasShortcuts'
import { useContextReveal } from './stage/useContextReveal'
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

const NO_NOTES: ReadonlyMap<string, string> = new Map()
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
  const highlight = usePreferencesStore((s) => s.highlight)
  const dependents = usePreferencesStore((s) => s.dependents)
  const showGuides = usePreferencesStore((s) => s.guides)
  const viewOnly = usePreferencesStore((s) => s.viewOnly)
  // View mode shows the Flows panel in the editor's place, so the fit leaves the same room for it.
  const panelOpen = useViewStore((s) => s.editorOpen) || viewOnly
  const focusedFlow = useViewStore((s) => s.focusedFlow)
  const hoveredFlows = useViewStore((s) => s.hoveredFlows)
  const hoverFlows = useViewStore((s) => s.hoverFlows)
  // Edit mode's flow inspector takes the right column, so the fit leaves it free too.
  const inspectorOpen = !!useInspectedFlow()
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
  // The element under the pointer (or keyboard focus), for its note; unlike `hovered` it is not limited to a layer.
  const [hoveredRef, setHoveredRef] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  // hexId records which hexagon the edit started on, so a commit that lands after the current hexagon switches still targets it (ADR-05).
  const [editing, setEditing] = useState<{ id: string; collection: CollectionKey; name: string; at: Point; hexId: string; before: { map: HexaMap; focus: string } } | null>(null)

  const reveal = useContextReveal(model.hexagons)

  const { size, centre, panTo, view, viewport, setView, zoomFloor, dragging, fullscreen, setFullscreen, panned, onPointerDown, onPointerMove, onPointerUp, onPointerCancel } = useStageViewport({
    model,
    hex,
    mainRef,
    revision,
    panelOpen,
    inspectorOpen,
    onPanStart: () => {
      setHovered(null)
      setHoveredRef(null)
      hoverFlows([])
      reveal.rest(null)
    },
  })

  useCanvasShortcuts({ selected, linking, hexId, map, diagram, viewOnly, onDelete, onLinking, setSelected, setHovered })

  // Link mode was started before the switch: nothing may finish it now.
  useEffect(() => {
    if (viewOnly) onLinking(null)
  }, [viewOnly, onLinking])

  // The step being presented is the selection (which lights it and shows its note), and is panned into view.
  const stepNow = usePresentation()?.step
  useEffect(() => {
    if (!stepNow) return
    setSelected(stepNow.hexId === hexId ? stepNow.id : null)
    const at = model.hexagons.find((h) => h.id === stepNow.hexId)
    const kind = NODE_KIND[collectionOf(diagramOf(map, stepNow.hexId), stepNow.id)!]
    const node = at?.model.nodes.find((n) => n.ref === stepNow.id && n.kind === kind)
    if (at && node) panTo(translatedNodeBox(node, at.centre))
    return () => setSelected(null)
    // Re-fires on the step alone: the view and layout move on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepNow?.hexId, stepNow?.id])

  const { announcement, focusHexagon } = useHexagonFocus({ hexId, model, mainRef, view, viewport, setView, setSelected, onLinking })

  // Per laid-out hexagon, so a layout that holds one the map lacks simply has nothing to show for it.
  const { notes, planned } = useMemo(() => {
    const content = model.hexagons.map((h) => [h.id, map.hexagons.find((m) => m.id === h.id) ?? {}] as const)
    return { notes: new Map(content.map(([id, h]) => [id, notesOf(h)])), planned: new Map(content.map(([id, h]) => [id, plannedOf(h)])) }
  }, [model, map])
  const note = dragging ? null : noteToShow(notes.get(hexId) ?? NO_NOTES, selected, hoveredRef)

  // A selection or hover on an element the layout no longer draws (hidden as planned, deleted) must not linger:
  // it would still receive keys, and reappear with the element.
  useEffect(() => {
    const drawn = (ref: string | null) => ref === null || hexModel.nodes.some((n) => n.ref === ref)
    if (!drawn(selected)) setSelected(null)
    if (!drawn(hoveredRef)) setHoveredRef(null)
  }, [hexModel, selected, hoveredRef])

  // Insertion points, selection and editing all work in the current hexagon's own (untranslated) coordinates;
  // toScreen adds its centre once, so every overlay lands at the hexagon's place on the map (ADR-04).
  const toScreen = (p: Point) => ({
    x: (p.x + hex.centre.x - viewport.x) * viewport.scale,
    y: (p.y + hex.centre.y - viewport.y) * viewport.scale,
  })
  // The grow-menu anchors are already in map space (cell centres), unlike hexagon-local insertion points.
  const mapToScreen = (p: Point) => ({ x: (p.x - viewport.x) * viewport.scale, y: (p.y - viewport.y) * viewport.scale })
  // Referentially stable across viewport-only renders, so the memoized MapDiagram skips them.
  const targets = useMemo(() => (linking ? linkTargets(diagram, linking) : []), [diagram, linking])
  const linkTargetRefs = useMemo(() => new Set(targets.map((t) => t.targetRef)), [targets])
  // ADR-02: the ports of another hexagon a link-mode selection can connect to — empty unless `linking` is a port.
  const crossTargets = useMemo(() => (linking ? crossPortTargets(map, diagram, hexId, linking) : []), [map, diagram, hexId, linking])
  const crossLinkTargets = useMemo(() => targetsByHexagon(crossTargets), [crossTargets])
  // Only what is drawn can be followed, so the chain ends at the ports of a compact hexagon.
  const isolated = viewOnly && !!focusedFlow && diagram.useCases.some((u) => u.id === focusedFlow)
  // A hover previews the union of the hovered element's flows, in either mode, where highlighting is on and nothing is
  // selected or being linked; an isolated flow wins (Edit mode never isolates, so a leftover focus there does not block it).
  // The Flows panel lists every hexagon's rows, and a hovered id names only its use case: the current hexagon owns it
  // first, else the first hexagon of the map that has it (ids are checked per hexagon, not map-wide).
  const hexagonOf = (id: string) => (diagram.useCases.some((u) => u.id === id) ? hexId : map.hexagons.find((h) => h.useCases.some((u) => u.id === id))?.id)
  const previewed = highlight && !isolated && !selected && !linking ? hoveredFlows.filter((id) => hexagonOf(id)) : []
  const shownFlows = isolated ? [focusedFlow!] : previewed
  const chain = useMemo(
    () =>
      shownFlows.length
        ? unionChain(shownFlows.map((id) => flowChain(map, flowOf(map, hexagonOf(id)!, id))))
        : highlight && !linking && selected
          ? dependencyChain(map, hexId, selected, new Set(model.hexagons.filter((h) => !h.compact).map((h) => h.id)), dependents ? 'dependents' : 'dependencies')
          : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shownFlows.join(' '), highlight, linking, selected, map, hexId, model, dependents],
  )
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
  const visiblePoints = hovered && !viewOnly ? insertionPoints(hexModel, diagram).filter((p) => p.layer === hovered) : []
  const pick = (point: InsertionPoint, choice?: DomainType) => {
    const { collection, patch } = insertionItem(point.action, choice)
    const before = { map, focus: hexId }
    const id = addItem(hexId, collection, patch)
    setEditing({ id, collection, name: patch.name, at: point.at, hexId, before })
  }
  const revealFrom = (target: Element) => {
    const ref = refOf(target) ?? (target.closest('[data-hexagon-title]') ? 'hexagon' : null)
    if (ref) onReveal(ref, true, hexIdOf(target) ?? hexId)
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
        className={['canvas', `zoom-${zoomLevel(viewport.scale)}`, titlesOverlaid(viewport.scale) && 'titles-overlaid', model.title && mapTitleOverlaid(model.title, viewport.scale) && 'map-title-overlaid'].filter(Boolean).join(' ')}
        style={{ '--zoom': viewport.scale } as CSSProperties}
        role="figure"
        aria-label={title || 'Architecture diagram'}
        onPointerOver={(e) => {
          if (dragging) return
          const target = e.target as Element
          if (hexIdOf(target) !== hexId) {
            setHoveredRef(null)
            hoverFlows([])
            return setHovered(null)
          }
          setHovered(layerOf(target))
          setHoveredRef(nodeRefOf(target))
          hoverFlows(threadsOf(target))
        }}
        onPointerMove={(e) => reveal.rest(dragging ? null : hullIdOf(e.target as Element))}
        onPointerLeave={(e) => {
          reveal.rest(null)
          if (!(e.relatedTarget as Element | null)?.closest?.('[data-plus]')) {
            setHovered(null)
            setHoveredRef(null)
            hoverFlows([])
          }
        }}
        onFocus={(e) => {
          if (pointerPressed.current) return
          setHovered(layerOf(e.target as Element))
          setHoveredRef(nodeRefOf(e.target as Element))
          hoverFlows(threadsOf(e.target as Element))
          reveal.focus(hexIdOf(e.target as Element))
        }}
        onBlur={(e) => {
          reveal.focus(null)
          if (!(e.relatedTarget as Element | null)?.closest?.('[data-plus]')) {
            setHovered(null)
            setHoveredRef(null)
            hoverFlows([])
          }
        }}
        data-link-mode={linking ? '' : undefined}
        data-emphasis={chain ? (dependents && !shownFlows.length ? 'dependents' : '') : undefined}
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
          const ref = nodeRefOf(target)
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
            onReveal('hexagon', true, clickedHexId)
            return
          }
          revealFrom(target)
        }}
        onKeyDown={(e) => {
          const target = e.target as Element
          const groupId = hexIdOf(target)
          const activation = e.key === 'Enter' || e.key === ' '
          const ref = nodeRefOf(target)
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
          linkTargets={linkTargetRefs}
          crossLinkTargets={crossLinkTargets}
          hovered={highlight ? hovered : null}
          chain={chain}
          notes={notes}
          planned={planned}
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
      <HexagonTitles model={model} mapToScreen={mapToScreen} scale={viewport.scale} />
      <BoxLabels model={model} map={map} hexId={hexId} forced={[selected, hoveredRef]} mapToScreen={mapToScreen} scale={viewport.scale} size={size} />
      <MapTitle model={model} mapToScreen={mapToScreen} scale={viewport.scale} />
      <ExpandToggles model={model} currentId={hexId} mapToScreen={mapToScreen} onToggle={onToggleExpanded} />
      {/* After the canvas controls so a name is never covered; it takes no pointer, so the controls stay clickable. */}
      <ContextReveals contexts={model.contexts} reveals={reveal.reveals} mapToScreen={mapToScreen} scale={viewport.scale} />
      {note && <NotePopover mainRef={mainRef} hexId={hexId} refId={note.ref} text={note.text} />}
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

      <StepCard />
      <ZoomControls canExpandAll={canCompact(model.hexagons.length)} viewport={viewport} zoomFloor={zoomFloor} centre={centre} setView={setView} fullscreen={fullscreen} setFullscreen={setFullscreen} />
    </main>
  )
}
