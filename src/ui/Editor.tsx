import { useRef, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { HEXAGONAL_KIND } from '../model/kinds'
import {
  defaultWall,
  DomainTypeSchema,
  DRIVING_WALLS,
  SideSchema,
  WallSchema,
  type CollectionKey,
  type Diagram,
  type HexaMap,
  type Link,
  type LinkEnd,
  type Side,
  type Wall,
} from '../model/schema'
import { parentCandidates } from '../model/links'
import { contextName, contextOrdinal, diagramOf, freeSides, occupiedContexts, UNTITLED_HEXAGON, type Destination, type LinkPatch } from '../model/map'
import { useMapStore, type Item } from '../model/store'
import { ChoiceMenu } from './ChoiceMenu'
import { Fold } from './Fold'
import { Icon } from './Icon'
import { sessionOf, type FieldSession, type OnPrune, type OnRecord } from './editor/fieldSession'
import { LinkSelect } from './editor/LinkSelect'
import { LinksSection } from './editor/LinksSection'
import { MapSection } from './editor/MapSection'
import { revealInEditor } from './revealInEditor'

const { addItem, updateItem, removeItem, setMeta, setContextName } = useMapStore.getState()

type Patch<K extends CollectionKey> = Partial<Omit<Item<K>, 'id'>>

const WALL_LABEL: Record<Wall, string> = { nw: 'North-west', w: 'West', sw: 'South-west', ne: 'North-east', e: 'East', se: 'South-east' }

const NO_FREE_SIDE_HINT = 'No free side around this hexagon.'
const LAST_HEXAGON_HINT = 'A map needs at least one hexagon.'
const NO_CONTEXT_TO_MOVE_HINT = 'This hexagon is alone in the only bounded context.'
/** Stands in for a context id in the move menu: a new context has none yet. */
const NEW_CONTEXT = ''

const DOMAIN_TYPE_LABEL = { entity: 'Entity', valueObject: 'Value object', aggregate: 'Aggregate', domainService: 'Domain service' }

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

interface SectionProps<K extends CollectionKey> {
  hexId: string
  map: HexaMap
  onPrune: OnPrune
  onRecord: OnRecord
  fieldSession: FieldSession
  collection: K
  items: Item<K>[]
  title: string
  noun: string
  empty: string
  fields?: (item: Item<K>, update: (patch: Patch<K>) => void) => ReactNode
  /** Replaces the single "+". */
  actions?: ReactNode
  /** Cards listed under subheadings instead of one list. */
  groups?: { key: string; title: string; items: Item<K>[] }[]
}

function Section<K extends CollectionKey>({ hexId, map, onPrune, onRecord, fieldSession, collection, items, title, noun, empty, fields, actions, groups }: SectionProps<K>) {
  const session = sessionOf(fieldSession)
  const before = { map, focus: hexId }
  // A discrete edit is its own step: the prune toast when it broke links, a silent step otherwise.
  const report = (pruned: Link[]) => (pruned.length ? onPrune(pruned, before) : onRecord(before))
  const add = (
    <button
      type="button"
      className="icon-button small"
      aria-label={`Add ${noun}`}
      title={`Add ${noun}`}
      onClick={() => {
        onRecord(before)
        addItem(hexId, collection)
      }}
    >
      <Icon name="plus" />
    </button>
  )
  const cards = (list: Item<K>[]) => (
        <ul className="items">
          {list.map((item) => {
            const update = (patch: Patch<K>) => report(updateItem(hexId, collection, item.id, patch))
            const type = (patch: Patch<K>) => updateItem(hexId, collection, item.id, patch)
            return (
              <li key={item.id} className="item" data-item-id={item.id}>
                <input className="name" aria-label={`${noun} name`} value={item.name} onChange={(e) => type({ name: e.target.value } as Patch<K>)} {...session} />
                <button
                  type="button"
                  className="icon-button small remove"
                  aria-label={`Remove ${noun} ${item.name}`}
                  title={`Remove ${noun}`}
                  onClick={() => report(removeItem(hexId, collection, item.id))}
                >
                  <Icon name="close" />
                </button>
                {fields?.(item, update)}
                <details className="note">
                  <summary>Note</summary>
                  <textarea aria-label={`Note for ${item.name}`} rows={2} value={item.note ?? ''} onChange={(e) => type({ note: e.target.value || undefined } as Patch<K>)} {...session} />
                </details>
              </li>
            )
          })}
        </ul>
  )
  return (
    <Fold id={collection} title={title} count={items.length} actions={actions ?? add}>
      {!items.length ? (
        <p className="empty">{empty}</p>
      ) : groups ? (
        groups.map((g) => (
          <div key={g.key} className="port-group">
            <h3>
              {g.title} · {g.items.length}
            </h3>
            {cards(g.items)}
          </div>
        ))
      ) : (
        cards(items)
      )}
    </Fold>
  )
}

const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a')
const capitalise = (text: string) => text[0].toUpperCase() + text.slice(1)

/** A new port lands on its side's default wall, with the caret already in its name. */
function addPort(hexId: string, side: Side) {
  let id = ''
  flushSync(() => {
    id = addItem(hexId, 'ports', { side, wall: defaultWall(side) })
  })
  revealInEditor(id, true)
}

function adaptersBySide(d: Diagram) {
  const portSide = new Map(d.ports.map((p) => [p.id, p.side]))
  return (side: Side) => d.adapters.filter((a) => (a.portId ? portSide.get(a.portId) === side : true))
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
  const labels = HEXAGONAL_KIND.labels
  const adaptersOn = adaptersBySide(d)
  const sideLabel: Record<Side, string> = { driving: labels.drivingPort, driven: labels.drivenPort }
  const currentCell = map.hexagons.find((h) => h.id === hexId)?.cell
  const canGrow = !!currentCell && freeSides(map, currentCell).length > 0
  const canDelete = map.hexagons.length > 1
  const ownContext = map.hexagons.find((h) => h.id === hexId)?.contextId
  const moveChoices = [
    ...occupiedContexts(map).filter((c) => c.id !== ownContext).map((c) => ({ id: c.id, label: contextName(map, c.id) })),
    ...(map.hexagons.filter((h) => h.contextId === ownContext).length > 1 ? [{ id: NEW_CONTEXT, label: 'New bounded context' }] : []),
  ]
  // Keyed by contextId, so renaming two contexts in the same session (unlikely, but never concurrent within one
  // input) each keeps its own pre-edit snapshot from focus to blur.
  const contextRenameBefore = useRef(new Map<string, HexaMap>())
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

        <Section
          hexId={hexId}
          map={map}
          onPrune={onPrune}
          onRecord={onRecord}
          fieldSession={fieldSession}
          collection="domain"
          items={d.domain}
          title="Domain"
          noun="domain item"
          empty="No domain items yet. Add the entities and value objects at the core."
          fields={(item, update) => (
            <>
              <label className="field">
                <span>Type</span>
                <select value={item.type} onChange={(e) => update({ type: DomainTypeSchema.parse(e.target.value) })}>
                  {DomainTypeSchema.options.map((t) => <option key={t} value={t}>{DOMAIN_TYPE_LABEL[t]}</option>)}
                </select>
              </label>
              <LinkSelect label="Belongs to" value={item.parentId} options={parentCandidates(d.domain, item.id)} onChange={(parentId) => update({ parentId })} />
            </>
          )}
        />

        <Section
          hexId={hexId}
          map={map}
          onPrune={onPrune}
          onRecord={onRecord}
          fieldSession={fieldSession}
          collection="useCases"
          items={d.useCases}
          title="Use cases"
          noun="use case"
          empty="No use cases yet. Add what the application does."
          fields={(item, update) => (
            <label className="field">
              <span>Placement</span>
              <select aria-label="Placement" value={item.placement ?? 'top'} onChange={(e) => update({ placement: e.target.value === 'top' ? undefined : WallSchema.parse(e.target.value) })}>
                <option value="top">Under the title</option>
                {WallSchema.options.map((w) => <option key={w} value={w}>{WALL_LABEL[w]}</option>)}
              </select>
            </label>
          )}
        />

        <Section
          hexId={hexId}
          map={map}
          onPrune={onPrune}
          onRecord={onRecord}
          fieldSession={fieldSession}
          collection="ports"
          items={d.ports}
          title="Ports"
          noun="port"
          actions={SideSchema.options.map((side) => (
            <button
              key={side}
              type="button"
              className="text-button small"
              aria-label={`Add ${article(sideLabel[side])} ${sideLabel[side]}`}
              title={`Add ${article(sideLabel[side])} ${sideLabel[side]}`}
              onClick={() => {
                onRecord({ map, focus: hexId })
                addPort(hexId, side)
              }}
            >
              + {sideLabel[side].split(' ')[0]}
            </button>
          ))}
          groups={SideSchema.options.map((side) => ({ key: side, title: `${capitalise(sideLabel[side])}s`, items: d.ports.filter((p) => p.side === side) }))}
          empty="No ports yet. Add one per boundary the use cases expose or need."
          fields={(item, update) => (
            <>
              <label className="field">
                <span>Side</span>
                {/* A wall belongs to one side's half, so changing side drops it back to that side's default. */}
                <select value={item.side} onChange={(e) => update({ side: SideSchema.parse(e.target.value), wall: undefined })}>
                  {SideSchema.options.map((s) => <option key={s} value={s}>{sideLabel[s]}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Wall</span>
                <select value={item.wall ?? defaultWall(item.side)} onChange={(e) => update({ wall: WallSchema.parse(e.target.value) })}>
                  {WallSchema.options
                    .filter((w) => DRIVING_WALLS.has(w) === (item.side === 'driving'))
                    .map((w) => <option key={w} value={w}>{WALL_LABEL[w]}</option>)}
                </select>
              </label>
              <LinkSelect label="Use case" value={item.useCaseId} options={d.useCases} onChange={(useCaseId) => update({ useCaseId })} />
            </>
          )}
        />

        <Section
          hexId={hexId}
          map={map}
          onPrune={onPrune}
          onRecord={onRecord}
          fieldSession={fieldSession}
          collection="adapters"
          items={d.adapters}
          title="Adapters"
          noun="adapter"
          empty="No adapters yet. Add the code that plugs into a port."
          fields={(item, update) => (
            <LinkSelect label="Port" value={item.portId} options={d.ports.map((p) => ({ id: p.id, name: `${p.name} (${sideLabel[p.side]})` }))} onChange={(portId) => update({ portId })} />
          )}
        />

        <Section
          hexId={hexId}
          map={map}
          onPrune={onPrune}
          onRecord={onRecord}
          fieldSession={fieldSession}
          collection="actors"
          items={d.actors}
          title="Actors"
          noun="actor"
          empty="No actors yet. Add who or what drives the application."
          fields={(item, update) => (
            <LinkSelect label="Calls adapter" value={item.adapterId} options={adaptersOn('driving')} onChange={(adapterId) => update({ adapterId })} />
          )}
        />

        <Section
          hexId={hexId}
          map={map}
          onPrune={onPrune}
          onRecord={onRecord}
          fieldSession={fieldSession}
          collection="externals"
          items={d.externals}
          title="External systems"
          noun="external system"
          empty="No external systems yet. Add databases, APIs and services the adapters talk to."
          fields={(item, update) => (
            <LinkSelect label="Used by adapter" value={item.adapterId} options={adaptersOn('driven')} onChange={(adapterId) => update({ adapterId })} />
          )}
        />
      </div>
    </aside>
  )
}
