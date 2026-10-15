import { useEffect } from 'react'
import { legendFor } from '../layout/legend'
import { flowsOf, type Flow } from '../model/flow'
import { diagramOf, UNTITLED_HEXAGON } from '../model/map'
import { useMapStore } from '../model/store'
import { threadSlots } from '../model/threads'
import { threadStyle } from '../render/ThreadDots'
import { PresentButton } from './PresentPanel'
import { useViewStore } from './state/viewStore'

/** One row per use case of hexagon `hexId` (the current one by default); picking one focuses its hexagon and flow, picking the focused one again clears it. */
export function FlowRows({ hexId: given }: { hexId?: string } = {}) {
  const map = useMapStore((s) => s.map)
  const current = useMapStore((s) => s.focus)
  const hexId = given ?? current
  const focused = useViewStore((s) => (hexId === current ? s.focusedFlow : null))
  const focusFlow = useViewStore((s) => s.focusFlow)
  const diagram = diagramOf(map, hexId)
  const names = new Map(diagram.useCases.map((u) => [u.id, u.name]))
  const slots = threadSlots(diagram)
  const pick = (id: string | null) => {
    useMapStore.getState().setFocus(hexId)
    focusFlow(id)
  }
  return flowsOf(map, hexId).map((flow) => (
    <FlowRow key={flow.useCaseId} flow={flow} name={names.get(flow.useCaseId) || 'Unnamed'} slot={slots.get(flow.useCaseId)!} pressed={focused === flow.useCaseId} onPick={pick} />
  ))
}

/** A row previews its flow on the canvas while hovered or focused; it must also let go when it unmounts mid-hover. */
function FlowRow({ flow, name, slot, pressed, onPick }: { flow: Flow; name: string; slot: number; pressed: boolean; onPick: (id: string | null) => void }) {
  const hoverFlows = useViewStore((s) => s.hoverFlows)
  const id = flow.useCaseId
  useEffect(
    () => () => {
      if (useViewStore.getState().hoveredFlows.includes(id)) hoverFlows([])
    },
    [id, hoverFlows],
  )
  return (
    <button
      type="button"
      className="flow-row"
      aria-pressed={pressed}
      style={threadStyle(slot)}
      onPointerEnter={() => hoverFlows([id])}
      onPointerLeave={() => hoverFlows([])}
      onFocus={() => hoverFlows([id])}
      onBlur={() => hoverFlows([])}
      onClick={() => onPick(pressed ? null : id)}
    >
      <span className="flow-bar" aria-hidden="true" />
      <span className="flow-name">{name}</span>
      <span className="flow-summary">{flow.starters.join(', ')} → {flow.destinations.join(', ')}</span>
      {flow.gaps.length > 0 && <span className="flow-gap">incomplete</span>}
    </button>
  )
}

/** View mode's sidebar: one row per use case, grouped by hexagon on a map of several; picking one isolates its flow on the canvas. */
export function FlowsPanel() {
  const map = useMapStore((s) => s.map)
  const hexId = useMapStore((s) => s.focus)
  const focused = useViewStore((s) => s.focusedFlow)
  const focusFlow = useViewStore((s) => s.focusFlow)
  // Map order, never current-first: picking another hexagon's flow must not reshuffle the list under the pointer.
  const layers = legendFor(diagramOf(map, hexId)).colours
  const hexagons = map.hexagons.filter((h) => h.useCases.length > 0)
  const count = hexagons.reduce((n, h) => n + h.useCases.length, 0)

  return (
    <aside className="island editor flows-panel" aria-label="Flows">
      <header className="editor-head">
        <h2>Flows</h2>
      </header>
      <div className="editor-body">
        {count === 0 ? (
          <p className="flows-help">No use cases yet. Switch to Edit to add one.</p>
        ) : (
          <>
            <p className="flows-help">Each flow is one use case, end to end. Pick one to follow it.</p>
            <button type="button" className="flow-row flow-row-all" aria-pressed={focused === null} onClick={() => focusFlow(null)}>
              <span className="flow-stack" aria-hidden="true"><i style={{ height: 16 }} /><i style={{ height: 11 }} /><i style={{ height: 14 }} /><i style={{ height: 8 }} /></span>
              <span className="flow-name">All flows</span> <span className="flow-count">{count}</span>
            </button>
            {hexagons.map((h) => (
              <section key={h.id} className="flow-group">
                {map.hexagons.length > 1 && <h3>{h.title || UNTITLED_HEXAGON}</h3>}
                <FlowRows hexId={h.id} />
              </section>
            ))}
          </>
        )}
      </div>
      <footer className="present-foot">
        <section className="layers-key" aria-label="Layers">
          <h4>Layers</h4>
          <ul>
            {layers.map((l) => (
              <li key={l.swatch}>
                <span className={`legend-swatch swatch-${l.swatch}`} aria-hidden="true" />
                {l.label}
              </li>
            ))}
          </ul>
        </section>
        {count > 0 && <PresentButton />}
      </footer>
    </aside>
  )
}
