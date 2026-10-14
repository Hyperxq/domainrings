import { flushSync } from 'react-dom'
import { useMapStore } from '../model/store'
import { FlowRows } from './FlowsPanel'
import { useHistoryStore } from './state/historyStore'
import { useViewStore } from './state/viewStore'

const { addItem } = useMapStore.getState()

/** Edit mode's flow list, atop the editor: a new flow is a use case, selected and ready to be named in the inspector. */
export function FlowsSection() {
  return (
    <section className="flows-section" aria-label="Flows">
      <div className="flows-head">
        <h2>Flows</h2>
        <button
          type="button"
          className="text-button small"
          onClick={() => {
            const { map, focus } = useMapStore.getState()
            useHistoryStore.getState().record({ map, focus })
            flushSync(() => useViewStore.getState().focusFlow(addItem(focus, 'useCases')))
            document.querySelector<HTMLInputElement>('input[aria-label="Flow name"]')?.select()
          }}
        >
          + New flow
        </button>
      </div>
      <FlowRows />
    </section>
  )
}
