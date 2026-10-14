import { flowsOf } from '../model/flow'
import { diagramOf } from '../model/map'
import { useMapStore } from '../model/store'
import { useViewStore } from './state/viewStore'

/** View mode's sidebar: one row per use case of the current hexagon; picking one isolates its flow on the canvas. */
export function FlowsPanel() {
  const map = useMapStore((s) => s.map)
  const hexId = useMapStore((s) => s.focus)
  const focused = useViewStore((s) => s.focusedFlow)
  const focusFlow = useViewStore((s) => s.focusFlow)
  const names = new Map(diagramOf(map, hexId).useCases.map((u) => [u.id, u.name]))
  const flows = flowsOf(map, hexId)

  return (
    <aside className="island editor flows-panel" aria-label="Flows">
      <header className="editor-head">
        <h2>Flows</h2>
      </header>
      <div className="editor-body">
        {flows.length === 0 ? (
          <p className="flows-help">No use cases yet. Switch to Edit to add one.</p>
        ) : (
          <>
            <p className="flows-help">Each flow is one use case, end to end. Pick one to follow it.</p>
            <button type="button" className="flow-row" aria-pressed={focused === null} onClick={() => focusFlow(null)}>
              <span className="flow-name">All flows</span> <span className="flow-count">{flows.length}</span>
            </button>
            {flows.map((flow) => (
              <button key={flow.useCaseId} type="button" className="flow-row" aria-pressed={focused === flow.useCaseId} onClick={() => focusFlow(focused === flow.useCaseId ? null : flow.useCaseId)}>
                <span className="flow-bar" aria-hidden="true" />
                <span className="flow-name">{names.get(flow.useCaseId)}</span>
                <span className="flow-summary">{flow.starters.join(', ')} → {flow.destinations.join(', ')}</span>
                {flow.gaps.length > 0 && <span className="flow-gap">incomplete</span>}
              </button>
            ))}
          </>
        )}
      </div>
    </aside>
  )
}
