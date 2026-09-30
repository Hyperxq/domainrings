import { useRef, useState, type FocusEvent, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { HEXAGONAL_KIND } from '../model/kinds'
import {
  defaultWall,
  DomainTypeSchema,
  DRIVING_WALLS,
  LinkPatternSchema,
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
import { contextName, contextOrdinal, crossHexagonPorts, diagramOf, freeSides, linkEndLabel, occupiedContexts, UNTITLED_HEXAGON, type Destination, type LinkPatch, type PortRef } from '../model/map'
import { useMapStore, type Item } from '../model/store'
import { ChoiceMenu } from './ChoiceMenu'
import { Fold } from './Fold'
import { Icon } from './Icon'
import { revealInEditor } from './revealInEditor'

const { addItem, updateItem, removeItem, setMeta, setMapMeta, setContextName } = useMapStore.getState()

type Patch<K extends CollectionKey> = Partial<Omit<Item<K>, 'id'>>

/** Reports the links a port change/removal broke (SEAM-06), with the map/focus from just before the edit, so the
 * caller can toast and offer undo — Section calls the store directly, so this is how App finds out. */
type OnPrune = (pruned: Link[], before: { map: HexaMap; focus: string }) => void

/** Records a silent undo step: the map/focus from just before an edit that raises no toast of its own. */
type OnRecord = (before: { map: HexaMap; focus: string }) => void

/** Tracks the one text field being edited, so its whole session (focus → blur) becomes a single undo step. */
interface FieldSession {
  begin: (before: { map: HexaMap; focus: string }, field: Element) => void
  end: () => void
}

const sessionOf = (fieldSession: FieldSession) => ({
  onFocus: (e: FocusEvent<HTMLElement>) => {
    const { map, focus } = useMapStore.getState()
    fieldSession.begin({ map, focus }, e.currentTarget)
  },
  onBlur: fieldSession.end,
})

const WALL_LABEL: Record<Wall, string> = { nw: 'North-west', w: 'West', sw: 'South-west', ne: 'North-east', e: 'East', se: 'South-east' }

const NO_FREE_SIDE_HINT = 'No free side around this hexagon.'
const LAST_HEXAGON_HINT = 'A map needs at least one hexagon.'
const NO_CONTEXT_TO_MOVE_HINT = 'This hexagon is alone in the only bounded context.'
/** Stands in for a context id in the move menu: a new context has none yet. */
const NEW_CONTEXT = ''

const DOMAIN_TYPE_LABEL = { entity: 'Entity', valueObject: 'Value object', aggregate: 'Aggregate', domainService: 'Domain service' }

interface Option {
  id: string
  name: string
}

function LinkSelect({ label, value, options, onChange }: { label: string; value?: string; options: Option[]; onChange: (id: string | undefined) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">Not linked</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.name || 'Unnamed'}</option>
        ))}
      </select>
    </label>
  )
}

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

/** The Links section (REQ-LNK-07): every link in the map, and the create form that is the Links-editor half of
 * "one action, two entry points" (ADR-02) — the canvas "Link to…" chip is the other. Each row also reaches
 * REQ-LNK-02 (edit an end's adapter, or a context-crossing link's pattern) and REQ-LNK-04 (delete) — reconnecting
 * an end to a different port is never offered here (REQ-LNK-03.1): delete + recreate is the only path. */
function LinksSection({
  map,
  onCreateLink,
  onUpdateLink,
  onDeleteLink,
}: {
  map: HexaMap
  onCreateLink: (from: LinkEnd, to: LinkEnd) => void
  onUpdateLink: (id: string, patch: LinkPatch) => void
  onDeleteLink: (id: string) => void
}) {
  const drivenPorts = crossHexagonPorts(map, 'driven')
  const drivingPorts = crossHexagonPorts(map, 'driving')
  const [fromIndex, setFromIndex] = useState<string | undefined>(undefined)
  const [toIndex, setToIndex] = useState<string | undefined>(undefined)
  const [fromAdapter, setFromAdapter] = useState<string | undefined>(undefined)
  const [toAdapter, setToAdapter] = useState<string | undefined>(undefined)
  const fromPort = fromIndex !== undefined ? drivenPorts[Number(fromIndex)] : undefined
  const toPort = toIndex !== undefined ? drivingPorts[Number(toIndex)] : undefined
  // Shared by the create form's chosen-but-not-yet-linked ports (PortRef) and an existing link's own ends
  // (LinkEnd) — both carry the same {hexagonId, portId} the adapter list is keyed on.
  const adapterOptions = (end?: { hexagonId: string; portId: string }) =>
    end ? map.hexagons.find((h) => h.id === end.hexagonId)!.adapters.filter((a) => a.portId === end.portId).map((a) => ({ id: a.id, name: a.name })) : []
  const portOptions = (ports: PortRef[]) => ports.map((p, i) => ({ id: String(i), name: `${p.hexagonTitle} · ${p.portName}` }))
  const patternOptions = LinkPatternSchema.options.map((p) => ({ id: p, name: p }))
  // REQ-LNK-06.2: a pattern only applies to a link whose two hexagons are in different bounded contexts — the
  // same rule checkMap enforces server-side, checked here client-side from the map already in hand.
  const crossesContext = (link: Link) => {
    const fromHexagon = map.hexagons.find((h) => h.id === link.from.hexagonId)!
    const toHexagon = map.hexagons.find((h) => h.id === link.to.hexagonId)!
    return fromHexagon.contextId !== toHexagon.contextId
  }

  // Omits adapterId entirely when none is chosen (rather than an explicit undefined), so a link created from here
  // is toStrictEqual to the same link created from the canvas chip (App.tsx's onLink builds its LinkEnd the same
  // lean way) — REQ-LNK-01.2's "identical link" is about the object shape, not just its meaning.
  const endOf = (port: PortRef, adapterId?: string): LinkEnd => (adapterId ? { hexagonId: port.hexagonId, portId: port.portId, adapterId } : { hexagonId: port.hexagonId, portId: port.portId })

  const submit = () => {
    if (!fromPort || !toPort) return
    onCreateLink(endOf(fromPort, fromAdapter), endOf(toPort, toAdapter))
    setFromIndex(undefined)
    setToIndex(undefined)
    setFromAdapter(undefined)
    setToAdapter(undefined)
  }

  return (
    <Fold id="links" title="Links" count={map.links.length}>
      {!map.links.length ? (
        <p className="empty">No links yet. Connect a driven port to a driving port on another hexagon.</p>
      ) : (
        <ul className="items">
          {map.links.map((link) => (
            <li key={link.id} className="item" data-item-id={link.id}>
              <span className="link-row-label">
                {linkEndLabel(map, link.from)} → {linkEndLabel(map, link.to)}
              </span>
              <button
                type="button"
                className="icon-button small remove"
                aria-label={`Delete link ${linkEndLabel(map, link.from)} to ${linkEndLabel(map, link.to)}`}
                title="Delete link"
                onClick={() => onDeleteLink(link.id)}
              >
                <Icon name="close" />
              </button>
              <details className="link-edit">
                <summary>Edit</summary>
                <LinkSelect
                  label="Driven port adapter"
                  value={link.from.adapterId}
                  options={adapterOptions(link.from)}
                  onChange={(adapterId) => onUpdateLink(link.id, { from: { adapterId: adapterId ?? null } })}
                />
                <LinkSelect
                  label="Driving port adapter"
                  value={link.to.adapterId}
                  options={adapterOptions(link.to)}
                  onChange={(adapterId) => onUpdateLink(link.id, { to: { adapterId: adapterId ?? null } })}
                />
                {crossesContext(link) && (
                  <LinkSelect
                    label="Pattern"
                    value={link.pattern}
                    options={patternOptions}
                    onChange={(pattern) => onUpdateLink(link.id, { pattern: (pattern as Link['pattern']) ?? null })}
                  />
                )}
              </details>
            </li>
          ))}
        </ul>
      )}
      <div className="link-create">
        <LinkSelect label="Driven port" value={fromIndex} options={portOptions(drivenPorts)} onChange={setFromIndex} />
        {fromPort && <LinkSelect label="Driven port adapter" value={fromAdapter} options={adapterOptions(fromPort)} onChange={setFromAdapter} />}
        <LinkSelect label="Driving port" value={toIndex} options={portOptions(drivingPorts)} onChange={setToIndex} />
        {toPort && <LinkSelect label="Driving port adapter" value={toAdapter} options={adapterOptions(toPort)} onChange={setToAdapter} />}
        <button type="button" className="text-button" disabled={!fromPort || !toPort} onClick={submit}>
          Create link
        </button>
      </div>
    </Fold>
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
  const [pendingImport, setPendingImport] = useState<((context: Destination) => void) | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
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
        <Fold id="map" title="Map">
          <label className="field">
            <span>Map title</span>
            <input value={map.title} onChange={(e) => setMapMeta({ title: e.target.value })} {...session} />
          </label>
          <ChoiceMenu
            label="Add hexagon from file…"
            choices={[
              { id: 'same' as const, label: `Import into ${contextLabel}` },
              { id: 'new' as const, label: 'Import into a new bounded context' },
            ]}
            autoOpen={pendingImport !== null}
            onTrigger={pendingImport ? undefined : () => importInputRef.current?.click()}
            onChoose={(context) => {
              pendingImport?.(context)
              setPendingImport(null)
            }}
            onDismiss={() => setPendingImport(null)}
          />
          <input
            ref={importInputRef}
            type="file"
            accept=".hexa,application/json"
            className="visually-hidden"
            aria-label="Add hexagon from a .hexa file"
            onChange={async (e) => {
              const input = e.currentTarget
              const file = input.files?.[0]
              input.value = ''
              if (!file) return
              const choose = await onAddFromFile(file)
              if (choose) setPendingImport(() => choose)
            }}
          />
        </Fold>

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
