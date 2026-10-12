import { useRef } from 'react'
import { contextOrdinal, occupiedContexts, UNTITLED_HEXAGON } from '../../model/map'
import type { HexaMap } from '../../model/schema'
import { useMapStore } from '../../model/store'
import { Fold } from '../Fold'

import { session } from './fieldSession'

const { setContextName, setMeta, setFocus } = useMapStore.getState()

type Context = ReturnType<typeof occupiedContexts>[number]

interface ContextsProps {
  map: HexaMap
  /** Reports a context rename/clear session (focus → blur) that actually changed the name, with the map from
   * just before it started — the toast/undo snapshot (NAME-03). Not called when a blur never changed anything. */
  onRenameContext: (before: HexaMap, contextId: string) => void
}

function ContextName({ map, ctx, onRenameContext }: ContextsProps & { ctx: Context }) {
  const before = useRef<HexaMap | undefined>(undefined)
  const ordinal = contextOrdinal(map, ctx.id)
  return (
    <input
      className="name"
      aria-label={`Name for ${ordinal}`}
      placeholder={ordinal}
      value={ctx.name ?? ''}
      onFocus={() => (before.current = map)}
      onChange={(e) => setContextName(ctx.id, e.target.value)}
      onBlur={(e) => {
        // Trimmed on commit, not on every keystroke: the input is controlled by the stored name, so
        // trimming live would eat a trailing space before the author can type the next word.
        const trimmed = e.target.value.trim()
        if (trimmed !== (ctx.name ?? '')) setContextName(ctx.id, trimmed)
        const snapshot = before.current
        before.current = undefined
        // Stored names, not display labels: typing the placeholder's own text changes the data but not the label.
        const storedName = (m: HexaMap) => m.contexts.find((c) => c.id === ctx.id)?.name || ''
        if (snapshot && storedName(snapshot) !== storedName(useMapStore.getState().map)) onRenameContext(snapshot, ctx.id)
      }}
    />
  )
}

/** The focused hexagon's bounded context: its name, then its hexagons (the focused one editable, the rest focus targets). */
export function ContextSection({ hexId, ...props }: ContextsProps & { hexId: string }) {
  const { map } = props
  const ownId = map.hexagons.find((h) => h.id === hexId)?.contextId
  const own = occupiedContexts(map).find((c) => c.id === ownId)
  if (!own) return null
  return (
    <Fold id="context" title="Bounded context">
      <ContextName {...props} ctx={own} />
      <ul className="items">
        {map.hexagons
          .filter((h) => h.contextId === own.id)
          .map((h) => (
            <li key={h.id} className="item">
              {h.id === hexId ? (
                <label className="field" data-item-id="hexagon">
                  <span>Hexagon title</span>
                  <input value={h.title} onChange={(e) => setMeta(hexId, { title: e.target.value })} {...session} />
                </label>
              ) : (
                <button type="button" className="text-button" onClick={() => setFocus(h.id)}>
                  {h.title || UNTITLED_HEXAGON}
                </button>
              )}
            </li>
          ))}
      </ul>
    </Fold>
  )
}

/** One name field per occupied bounded context other than the focused hexagon's. */
export function OtherContextsSection({ hexId, ...props }: ContextsProps & { hexId: string }) {
  const { map } = props
  const ownId = map.hexagons.find((h) => h.id === hexId)?.contextId
  const others = occupiedContexts(map).filter((c) => c.id !== ownId)
  if (!others.length) return null
  return (
    <Fold id="contexts" title="Other bounded contexts" count={others.length}>
      <ul className="items">
        {others.map((ctx) => (
          <li key={ctx.id} className="item">
            <ContextName {...props} ctx={ctx} />
          </li>
        ))}
      </ul>
    </Fold>
  )
}
