import type { ReactNode } from 'react'
import { HEXAGONAL_KIND } from '../../model/kinds'
import { contextName, diagramOf, freeSides, occupiedContexts } from '../../model/map'
import type { Diagram, HexaMap } from '../../model/schema'
import { useMapStore } from '../../model/store'
import { ChoiceMenu } from '../ChoiceMenu'
import { Fold } from '../Fold'
import { useHistoryStore } from '../state/historyStore'
import { CollectionSections } from './CollectionSections'
import { session } from './fieldSession'
import { PlannedToggle } from './PlannedToggle'

const { setMeta } = useMapStore.getState()
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

export interface SubdomainActions {
  onAddHexagon: (hexId: string) => void
  onDeleteHexagon: (hexId: string) => void
  /** Moves the subdomain into the given context, or a new one when `undefined`. */
  onMoveToContext: (hexId: string, contextId: string | undefined) => void
}

/** Everything one subdomain (a hexagon) owns, edited in place whichever hexagon is focused. Mounted only while its
 * tree branch is open, so a large map doesn't render every subdomain's fields. */
export function SubdomainSection({ map, hexId, onAddHexagon, onDeleteHexagon, onMoveToContext }: { map: HexaMap; hexId: string } & SubdomainActions) {
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
    <div data-subdomain={hexId}>
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

      <CollectionSections hexId={hexId} map={map} diagram={d} />
    </div>
  )
}
