import type { ReactNode } from 'react'
import { HEXAGONAL_KIND } from '../model/kinds'
import type { Diagram, HexaMap, LinkEnd } from '../model/schema'
import { contextName, diagramOf, freeSides, occupiedContexts, UNTITLED_HEXAGON, type Destination, type LinkPatch } from '../model/map'
import { useMapStore } from '../model/store'
import { ChoiceMenu } from './ChoiceMenu'
import { Fold } from './Fold'
import { Icon } from './Icon'
import { sessionOf, type FieldSession, type OnPrune, type OnRecord } from './editor/fieldSession'
import { CollectionSections } from './editor/CollectionSections'
import { ContextsSection } from './editor/ContextsSection'
import { LinksSection } from './editor/LinksSection'
import { MapSection } from './editor/MapSection'

const { setMeta } = useMapStore.getState()

const NO_FREE_SIDE_HINT = 'No free side around this hexagon.'
const LAST_HEXAGON_HINT = 'A map needs at least one hexagon.'
const NO_CONTEXT_TO_MOVE_HINT = 'This hexagon is alone in the only bounded context.'
/** Stands in for a context id in the move menu: a new context has none yet. */
const NEW_CONTEXT = ''

interface HintedButtonProps {
  enabled: boolean
  hintId: string
  onClick: () => void
  children: ReactNode
}

/** A text button that's disabled-but-focusable when `enabled` is false, styled dim; `aria-describedby` points at the
 * visible hint the caller renders (see `Hint`) so a screen reader user hears the same reason. */
function HintedButton({ enabled, hintId, onClick, children }: HintedButtonProps) {
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

export function Editor({
  open,
  onToggle,
  onPrune,
  onRecord,
  fieldSession,
  onAddHexagon,
  onDeleteHexagon,
  onMoveToContext,
  onAddFromFile,
  contextLabel,
  onRenameContext,
  onCreateLink,
  onUpdateLink,
  onDeleteLink,
}: {
  open: boolean
  onToggle: () => void
  onPrune: OnPrune
  onRecord: OnRecord
  fieldSession: FieldSession
  onAddHexagon: () => void
  onDeleteHexagon: () => void
  /** Moves the current hexagon into the given context, or a new one when `undefined`. */
  onMoveToContext: (contextId: string | undefined) => void
  /** Reads the picked file (IMP-01): resolves to the step that finishes the import once the author picks a
   * destination when the file holds one hexagon, or to nothing when it needed no question or was refused. */
  onAddFromFile: (file: File) => Promise<((context: Destination) => void) | undefined>
  /** The current hexagon's own bounded context, for the import menu's "Import into {context}" choice. */
  contextLabel: string
  /** Reports a context rename/clear session (focus → blur) that actually changed the name, with the map from
   * just before it started — the toast/undo snapshot (NAME-03). Not called when a blur never changed anything. */
  onRenameContext: (before: HexaMap, contextId: string) => void
  /** Creates a map-level link from the Links section's own create form — the second of the two entry points
   * ADR-02 requires to share one write path with the canvas "Link to…" chip. */
  onCreateLink: (from: LinkEnd, to: LinkEnd) => void
  /** Patches an existing link's adapter(s) or pattern from its row's edit disclosure (REQ-LNK-02). */
  onUpdateLink: (id: string, patch: LinkPatch) => void
  /** Deletes an existing link from its row (REQ-LNK-04). */
  onDeleteLink: (id: string) => void
}) {
  const map = useMapStore((s) => s.map)
  const hexId = useMapStore((s) => s.focus)
  const d = diagramOf(map, hexId)
  const currentCell = map.hexagons.find((h) => h.id === hexId)?.cell
  const canGrow = !!currentCell && freeSides(map, currentCell).length > 0
  const canDelete = map.hexagons.length > 1
  const ownContext = map.hexagons.find((h) => h.id === hexId)?.contextId
  const moveChoices = [
    ...occupiedContexts(map).filter((c) => c.id !== ownContext).map((c) => ({ id: c.id, label: contextName(map, c.id) })),
    ...(map.hexagons.filter((h) => h.contextId === ownContext).length > 1 ? [{ id: NEW_CONTEXT, label: 'New bounded context' }] : []),
  ]
  const session = sessionOf(fieldSession)

  return (
    <aside className={`island editor${open ? '' : ' is-collapsed'}`} aria-label="Diagram editor">
      <header className="editor-head">
        <h2>{d.title || UNTITLED_HEXAGON}</h2>
        <button type="button" className="icon-button" aria-expanded={open} aria-controls="editor-body" aria-label={open ? 'Collapse editor' : 'Expand editor'} title={open ? 'Collapse editor' : 'Expand editor'} onClick={onToggle}>
          <Icon name="panel" />
        </button>
      </header>

      <div id="editor-body" className="editor-body" hidden={!open}>
        <MapSection title={map.title} contextLabel={contextLabel} onAddFromFile={onAddFromFile} session={session} />

        <ContextsSection map={map} onRenameContext={onRenameContext} />

        <LinksSection map={map} onCreateLink={onCreateLink} onUpdateLink={onUpdateLink} onDeleteLink={onDeleteLink} />

        <Fold id="hexagon" title="Hexagon">
          <p className="field-static">
            <span>Bounded context</span>
            <span>{contextLabel}</span>
          </p>
          <label className="field" data-item-id="hexagon">
            <span>Hexagon title</span>
            <input value={d.title} onChange={(e) => setMeta(hexId, { title: e.target.value })} {...session} />
          </label>
          <label className="field">
            <span>Subtitle</span>
            <input value={d.subtitle ?? ''} onChange={(e) => setMeta(hexId, { subtitle: e.target.value || undefined })} {...session} />
          </label>
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
            <HintedButton enabled={canGrow} hintId="no-free-side-hint" onClick={onAddHexagon}>
              Add hexagon
            </HintedButton>
            <HintedButton enabled={canDelete} hintId="last-hexagon-hint" onClick={onDeleteHexagon}>
              Delete hexagon
            </HintedButton>
          </div>
          {!canGrow && <Hint id="no-free-side-hint">{NO_FREE_SIDE_HINT}</Hint>}
          {!canDelete && <Hint id="last-hexagon-hint">{LAST_HEXAGON_HINT}</Hint>}
          {moveChoices.length ? (
            <ChoiceMenu label="Move to context…" choices={moveChoices} onChoose={(id) => onMoveToContext(id === NEW_CONTEXT ? undefined : id)} />
          ) : (
            <>
              <HintedButton enabled={false} hintId="no-context-to-move-hint" onClick={() => {}}>
                Move to context…
              </HintedButton>
              <Hint id="no-context-to-move-hint">{NO_CONTEXT_TO_MOVE_HINT}</Hint>
            </>
          )}
        </Fold>

        <Fold id="layers" title="Layers" count={HEXAGONAL_KIND.rings.length}>
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

        <CollectionSections hexId={hexId} map={map} diagram={d} onPrune={onPrune} onRecord={onRecord} fieldSession={fieldSession} />
      </div>
    </aside>
  )
}
