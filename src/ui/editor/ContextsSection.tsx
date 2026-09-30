import { useRef } from 'react'
import { contextOrdinal, occupiedContexts } from '../../model/map'
import type { HexaMap } from '../../model/schema'
import { useMapStore } from '../../model/store'
import { Fold } from '../Fold'

const { setContextName } = useMapStore.getState()

/** One name field per occupied bounded context. */
export function ContextsSection({
  map,
  onRenameContext,
}: {
  map: HexaMap
  /** Reports a context rename/clear session (focus → blur) that actually changed the name, with the map from
   * just before it started — the toast/undo snapshot (NAME-03). Not called when a blur never changed anything. */
  onRenameContext: (before: HexaMap, contextId: string) => void
}) {
  // Keyed by contextId, so renaming two contexts in the same session (unlikely, but never concurrent within one
  // input) each keeps its own pre-edit snapshot from focus to blur.
  const contextRenameBefore = useRef(new Map<string, HexaMap>())
  return (
    <Fold id="contexts" title="Bounded contexts" count={occupiedContexts(map).length}>
      <ul className="items">
        {occupiedContexts(map).map((ctx) => {
          const ordinal = contextOrdinal(map, ctx.id)
          return (
            <li key={ctx.id} className="item">
              <input
                className="name"
                aria-label={`Name for ${ordinal}`}
                placeholder={ordinal}
                value={ctx.name ?? ''}
                onFocus={() => contextRenameBefore.current.set(ctx.id, map)}
                onChange={(e) => setContextName(ctx.id, e.target.value)}
                onBlur={(e) => {
                  // Trimmed on commit, not on every keystroke: the input is controlled by the stored name, so
                  // trimming live would eat a trailing space before the author can type the next word.
                  const trimmed = e.target.value.trim()
                  if (trimmed !== (ctx.name ?? '')) setContextName(ctx.id, trimmed)
                  const before = contextRenameBefore.current.get(ctx.id)
                  contextRenameBefore.current.delete(ctx.id)
                  // Stored names, not display labels: typing the placeholder's own text changes the data but not the label.
                  const storedName = (m: HexaMap) => m.contexts.find((c) => c.id === ctx.id)?.name || ''
                  if (before && storedName(before) !== storedName(useMapStore.getState().map)) onRenameContext(before, ctx.id)
                }}
              />
            </li>
          )
        })}
      </ul>
    </Fold>
  )
}
