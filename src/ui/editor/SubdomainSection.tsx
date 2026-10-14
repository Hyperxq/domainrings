import { useRef, type ReactNode } from 'react'
import { HEXAGONAL_KIND } from '../../model/kinds'
import { contextName, contextOrdinal, diagramOf, freeSides, occupiedContexts } from '../../model/map'
import type { Diagram, HexaMap } from '../../model/schema'
import { useMapStore } from '../../model/store'
import { ChoiceMenu } from '../ChoiceMenu'
import { Fold } from '../Fold'
import { useHistoryStore } from '../state/historyStore'
import { session } from './fieldSession'
import { PlannedToggle } from './PlannedToggle'

const { setMeta, setContextName } = useMapStore.getState()
const { record } = useHistoryStore.getState()

/** Stands in for a context id in the move menu: a new context has none yet. */
const NEW_CONTEXT = ''

/** A text button that's disabled-but-focusable when `enabled` is false, styled dim; `aria-describedby` points at the
 * visible hint the caller renders (see `Hint`) so a screen reader user hears the same reason. */
function HintedButton({ enabled, hintId, onClick, children }: { enabled: boolean; hintId: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="text-button" aria-disabled={enabled ? undefined : true} aria-describedby={enabled ? undefined : hintId} onClick={() => enabled && onClick()}>
      {children}
    </button>
  )
}

function Hint({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="hint">
      {children}
    </p>
  )
}

/** A bounded context's name: every occupied one is renamed here, so no other subdomain has to be focused first. */
function ContextName({ map, contextId, onRenameContext }: { map: HexaMap; contextId: string; onRenameContext: SubdomainProps['onRenameContext'] }) {
  const before = useRef<HexaMap | undefined>(undefined)
  const name = map.contexts.find((c) => c.id === contextId)?.name ?? ''
  const ordinal = contextOrdinal(map, contextId)
  return (
    <input
      className="name"
      aria-label={`Name for ${ordinal}`}
      placeholder={ordinal}
      value={name}
      onFocus={() => (before.current = map)}
      onChange={(e) => setContextName(contextId, e.target.value)}
      onBlur={(e) => {
        // Trimmed on commit, not on every keystroke: the input is controlled by the stored name, so
        // trimming live would eat a trailing space before the author can type the next word.
        const trimmed = e.target.value.trim()
        if (trimmed !== name) setContextName(contextId, trimmed)
        const snapshot = before.current
        before.current = undefined
        // Stored names, not display labels: typing the placeholder's own text changes the data but not the label.
        const storedName = (m: HexaMap) => m.contexts.find((c) => c.id === contextId)?.name || ''
        if (snapshot && storedName(snapshot) !== storedName(useMapStore.getState().map)) onRenameContext(snapshot, contextId)
      }}
    />
  )
}

export interface SubdomainActions {
  onAddHexagon: (hexId: string) => void
  onDeleteHexagon: (hexId: string) => void
  /** Moves the subdomain into the given context, or a new one when `undefined`. */
  onMoveToContext: (hexId: string, contextId: string | undefined) => void
}

interface SubdomainProps extends SubdomainActions {
  map: HexaMap
  hexId: string
  /** Reports a context rename/clear session (focus → blur) that actually changed the name, with the map from
   * just before it started — the toast/undo snapshot (NAME-03). Not called when a blur never changed anything. */
  onRenameContext: (before: HexaMap, contextId: string) => void
}

/** The current subdomain's own settings, and the bounded contexts' names. */
export function SubdomainSection({ map, hexId, onRenameContext, onAddHexagon, onDeleteHexagon, onMoveToContext }: SubdomainProps) {
  const d = diagramOf(map, hexId)
  const hex = map.hexagons.find((h) => h.id === hexId)!
  const canGrow = freeSides(map, hex.cell).length > 0
  const canDelete = map.hexagons.length > 1
  const moveChoices = [
    ...occupiedContexts(map).filter((c) => c.id !== hex.contextId).map((c) => ({ id: c.id, label: contextName(map, c.id) })),
    ...(map.hexagons.filter((h) => h.contextId === hex.contextId).length > 1 ? [{ id: NEW_CONTEXT, label: 'New bounded context' }] : []),
  ]
  const growHint = `no-free-side-hint-${hexId}`
  const deleteHint = `last-subdomain-hint-${hexId}`
  const moveHint = `no-context-to-move-hint-${hexId}`
  return (
    <>
      {occupiedContexts(map).map((c) => <ContextName key={c.id} map={map} contextId={c.id} onRenameContext={onRenameContext} />)}
      <label className="field" data-item-id="hexagon">
        <span>Subdomain title</span>
        <input value={d.title} onChange={(e) => setMeta(hexId, { title: e.target.value })} {...session} />
      </label>
      <label className="field">
        <span>Subtitle</span>
        <input value={d.subtitle ?? ''} onChange={(e) => setMeta(hexId, { subtitle: e.target.value || undefined })} {...session} />
      </label>
      <PlannedToggle
        planned={d.status === 'planned'}
        label="Planned subdomain"
        onChange={(planned) => {
          record({ map, focus: hexId })
          setMeta(hexId, { status: planned ? 'planned' : undefined })
        }}
      />
      <label className="field" data-item-id="composition">
        <span>Composition root</span>
        <input
          value={d.composition?.name ?? ''}
          placeholder="e.g. composition.ts"
          onChange={(e) => setMeta(hexId, { composition: e.target.value ? { ...d.composition, name: e.target.value } : undefined })}
          {...session}
        />
      </label>
      <div className="button-pair">
        <HintedButton enabled={canGrow} hintId={growHint} onClick={() => onAddHexagon(hexId)}>
          Add subdomain
        </HintedButton>
        <HintedButton enabled={canDelete} hintId={deleteHint} onClick={() => onDeleteHexagon(hexId)}>
          Delete subdomain
        </HintedButton>
      </div>
      {!canGrow && <Hint id={growHint}>No free side around this subdomain.</Hint>}
      {!canDelete && <Hint id={deleteHint}>A map needs at least one subdomain.</Hint>}
      {moveChoices.length ? (
        <ChoiceMenu label="Move to context…" choices={moveChoices} onChoose={(id) => onMoveToContext(hexId, id === NEW_CONTEXT ? undefined : id)} />
      ) : (
        <>
          <HintedButton enabled={false} hintId={moveHint} onClick={() => {}}>
            Move to context…
          </HintedButton>
          <Hint id={moveHint}>This subdomain is alone in the only bounded context.</Hint>
        </>
      )}

      <Fold id={`${hexId}:layers`} title="Layers" count={HEXAGONAL_KIND.rings.length}>
        <ul className="items">
          {HEXAGONAL_KIND.rings.map((ring) => {
            const override = d.layers?.[ring.role]
            const setLayer = (patch: { title?: string; subtitle?: string }) =>
              setMeta(hexId, { layers: { ...d.layers, [ring.role]: { ...override, ...patch } } as Diagram['layers'] })
            return (
              <li key={ring.role}>
                <fieldset className="item layer" data-item-id={`layer:${ring.role}`}>
                  <legend>{ring.name}</legend>
                  <label className="field">
                    <span>Ring title</span>
                    <input value={override?.title ?? ''} placeholder={ring.name} onChange={(e) => setLayer({ title: e.target.value || undefined })} {...session} />
                  </label>
                  <label className="field">
                    <span>Subtitle</span>
                    <input value={override?.subtitle ?? ''} placeholder={ring.subtitle ?? 'None'} onChange={(e) => setLayer({ subtitle: e.target.value || undefined })} {...session} />
                  </label>
                </fieldset>
              </li>
            )
          })}
        </ul>
      </Fold>
    </>
  )
}
