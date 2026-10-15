import { diagramOf } from '../model/map'
import { useMapStore } from '../model/store'
import { threadSlots } from '../model/threads'
import { threadStyle } from '../render/ThreadDots'
import { usePreferencesStore } from './state/preferencesStore'
import { useViewStore } from './state/viewStore'

/** The legend's thread key: a dot and the name of each use case of the hexagon. Hovering a row previews its flow on the canvas, clicking focuses it. */
export function ThreadLegend() {
  const map = useMapStore((s) => s.map)
  const hexId = useMapStore((s) => s.focus)
  const showPlanned = usePreferencesStore((s) => s.showPlanned)
  const hoverFlows = useViewStore((s) => s.hoverFlows)
  const focusFlow = useViewStore((s) => s.focusFlow)
  const diagram = diagramOf(map, hexId)
  const slots = threadSlots(diagram)
  const useCases = diagram.useCases.filter((u) => showPlanned || u.status !== 'planned')
  if (!useCases.length) return null
  return (
    <section className="legend-section" aria-label="Threads">
      <h3>Threads</h3>
      <ul className="legend-threads">
        {useCases.map((u) => (
          <li key={u.id}>
            <button
              type="button"
              onPointerEnter={() => hoverFlows([u.id])}
              onPointerLeave={() => hoverFlows([])}
              onFocus={() => hoverFlows([u.id])}
              onBlur={() => hoverFlows([])}
              onClick={() => focusFlow(u.id)}
            >
              <span className="thread-swatch" aria-hidden="true" style={threadStyle(slots.get(u.id)!)} />
              {u.name || 'Unnamed'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
