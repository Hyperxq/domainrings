import { useRef } from 'react'
import { contextName, contextOrdinal, occupiedContexts } from '../../model/map'
import type { HexaMap } from '../../model/schema'
import { useMapStore } from '../../model/store'
import { Fold } from '../Fold'
import { useViewStore } from '../state/viewStore'
import { SubdomainSection, type SubdomainActions } from './SubdomainSection'

const { setContextName } = useMapStore.getState()

const UNTITLED_SUBDOMAIN = 'Untitled subdomain'

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

/** Every occupied bounded context and, inside it, every subdomain; only the open branches render their content. */
export function ContextTree({ map, onRenameContext, ...actions }: ContextsProps & SubdomainActions) {
  const openNodes = useViewStore((s) => s.openNodes)
  const toggleNode = useViewStore((s) => s.toggleNode)
  const branch = (key: string) => ({ open: openNodes.has(key), onOpenChange: () => toggleNode(key) })
  return (
    <>
      {occupiedContexts(map).map((ctx) => {
        const key = `context:${ctx.id}`
        return (
          <Fold key={ctx.id} id={key} title={contextName(map, ctx.id)} {...branch(key)}>
            {openNodes.has(key) && (
              <>
                <ContextName map={map} onRenameContext={onRenameContext} ctx={ctx} />
                {map.hexagons
                  .filter((h) => h.contextId === ctx.id)
                  .map((h) => {
                    const subKey = `subdomain:${h.id}`
                    return (
                      <Fold key={h.id} id={subKey} title={h.title || UNTITLED_SUBDOMAIN} {...branch(subKey)}>
                        {openNodes.has(subKey) && <SubdomainSection map={map} hexId={h.id} {...actions} />}
                      </Fold>
                    )
                  })}
              </>
            )}
          </Fold>
        )
      })}
    </>
  )
}
