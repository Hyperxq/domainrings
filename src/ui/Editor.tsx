import { useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { KINDS } from '../model/kinds'
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
import { contextName, contextOrdinal, crossHexagonPorts, diagramOf, freeSides, UNTITLED_HEXAGON, type Destination, type PortRef } from '../model/map'
import { useMapStore, type Item } from '../model/store'
import { ChoiceMenu } from './ChoiceMenu'
import { Icon } from './Icon'

const { addItem, updateItem, removeItem, setMeta, setMapMeta, setContextName } = useMapStore.getState()

type Patch<K extends CollectionKey> = Partial<Omit<Item<K>, 'id'>>

/** Reports the links a port change/removal broke (SEAM-06), with the map/focus from just before the edit, so the
 * caller can toast and offer undo — Section calls the store directly, so this is how App finds out. */
type OnPrune = (pruned: Link[], before: { map: HexaMap; focus: string }) => void

const WALL_LABEL: Record<Wall, string> = { nw: 'North-west', w: 'West', sw: 'South-west', ne: 'North-east', e: 'East', se: 'South-east' }

const FLASH_MS = 1200
const NO_FREE_SIDE_HINT = 'No free side around this hexagon.'
const LAST_HEXAGON_HINT = 'A map needs at least one hexagon.'

/** Bring a card into view and flash it, so canvas and panel stay in step; `focus` also selects its first field. */
export function revealInEditor(id: string, focus: boolean) {
  const card = document.querySelector(`[data-item-id="${id}"]`)
  if (!card) return
  const section = card.closest('details.fold')
  if (section instanceof HTMLDetailsElement) section.open = true
  card.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  card.classList.add('is-flash')
  setTimeout(() => card.classList.remove('is-flash'), FLASH_MS)
  if (!focus) return
  const field = card.querySelector('input')
  field?.focus({ preventScroll: true })
  field?.select()
}

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

const SECTIONS_KEY = 'domainrings:editor-sections'

function readSections(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? '{}')
  } catch {
    return {}
  }
}

interface FoldProps {
  id: string
  title: string
  count?: number
  /** Buttons over the summary row's right end, such as the section's "+". */
  actions?: ReactNode
  children: ReactNode
}

/** A collapsible editor section, open by default; each one remembers whether it was left open. */
function Fold({ id, title, count, actions, children }: FoldProps) {
  const [open, setOpen] = useState(() => readSections()[id] ?? true)
  const settle = (next: boolean) => {
    setOpen(next)
    try {
      localStorage.setItem(SECTIONS_KEY, JSON.stringify({ ...readSections(), [id]: next }))
    } catch {
      // The section still toggles for this session.
    }
  }
  const headingId = `section-${id}`
  return (
    <section className="section" aria-labelledby={headingId}>
      {/* Outside the summary: a button nested in it would be interactive content inside a toggle. */}
      {actions && <span className="section-actions">{actions}</span>}
      {/* The click settles synchronously; toggle only catches opens from outside, such as revealInEditor. */}
      <details className="fold" open={open} onToggle={(e) => e.currentTarget.open !== open && settle(e.currentTarget.open)}>
        <summary
          className="section-head"
          onClick={(e) => {
            e.preventDefault()
            settle(!open)
          }}
        >
          <Icon name="chevron" />
          <h2 id={headingId}>{title}</h2>
          {count !== undefined && <span className="count">· {count}</span>}
        </summary>
        {children}
      </details>
    </section>
  )
}

interface HintedButtonProps {
  enabled: boolean
  hintId: string
  hint: string
  onClick: () => void
  children: ReactNode
}

/** A text button that's disabled-but-focusable when `enabled` is false, styled dim and paired with a visible hint
 * explaining why — `aria-describedby` also announces it, so a screen reader user hears the same reason. */
function HintedButton({ enabled, hintId, hint, onClick, children }: HintedButtonProps) {
  return (
    <>
      <button type="button" className="text-button" aria-disabled={enabled ? undefined : true} aria-describedby={enabled ? undefined : hintId} onClick={() => enabled && onClick()}>
        {children}
      </button>
      {!enabled && (
        <p id={hintId} className="hint">
          {hint}
        </p>
      )}
    </>
  )
}

interface SectionProps<K extends CollectionKey> {
  hexId: string
  map: HexaMap
  onPrune: OnPrune
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

function Section<K extends CollectionKey>({ hexId, map, onPrune, collection, items, title, noun, empty, fields, actions, groups }: SectionProps<K>) {
  const report = (pruned: Link[]) => pruned.length && onPrune(pruned, { map, focus: hexId })
  const add = (
    <button type="button" className="icon-button small" aria-label={`Add ${noun}`} title={`Add ${noun}`} onClick={() => addItem(hexId, collection)}>
      <Icon name="plus" />
    </button>
  )
  const cards = (list: Item<K>[]) => (
        <ul className="items">
          {list.map((item) => {
            const update = (patch: Patch<K>) => report(updateItem(hexId, collection, item.id, patch))
            return (
              <li key={item.id} className="item" data-item-id={item.id}>
                <input className="name" aria-label={`${noun} name`} value={item.name} onChange={(e) => update({ name: e.target.value } as Patch<K>)} />
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
                  <textarea aria-label={`Note for ${item.name}`} rows={2} value={item.note ?? ''} onChange={(e) => update({ note: e.target.value || undefined } as Patch<K>)} />
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

/** A link end as `{hexagonTitle} · {portName}`, for the Links section's list rows. */
function linkEndLabel(map: HexaMap, end: LinkEnd): string {
  const hexagon = map.hexagons.find((h) => h.id === end.hexagonId)
  const port = hexagon?.ports.find((p) => p.id === end.portId)
  return `${hexagon?.title || UNTITLED_HEXAGON} · ${port?.name ?? end.portId}`
}

/** The Links section (REQ-LNK-07): every link in the map, and the create form that is the Links-editor half of
 * "one action, two entry points" (ADR-02) — the canvas "Link to…" chip is the other. List rows are read-only:
 * editing or deleting a link is not yet wired here. */
function LinksSection({ map, onCreateLink }: { map: HexaMap; onCreateLink: (from: LinkEnd, to: LinkEnd) => void }) {
  const drivenPorts = crossHexagonPorts(map, 'driven')
  const drivingPorts = crossHexagonPorts(map, 'driving')
  const [fromIndex, setFromIndex] = useState<string | undefined>(undefined)
  const [toIndex, setToIndex] = useState<string | undefined>(undefined)
  const [fromAdapter, setFromAdapter] = useState<string | undefined>(undefined)
  const [toAdapter, setToAdapter] = useState<string | undefined>(undefined)
  const fromPort = fromIndex !== undefined ? drivenPorts[Number(fromIndex)] : undefined
  const toPort = toIndex !== undefined ? drivingPorts[Number(toIndex)] : undefined
  const adapterOptions = (port?: PortRef) =>
    port ? map.hexagons.find((h) => h.id === port.hexagonId)!.adapters.filter((a) => a.portId === port.portId).map((a) => ({ id: a.id, name: a.name })) : []
  const portOptions = (ports: PortRef[]) => ports.map((p, i) => ({ id: String(i), name: `${p.hexagonTitle} · ${p.portName}` }))

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
              {linkEndLabel(map, link.from)} → {linkEndLabel(map, link.to)}
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
  onAddHexagon,
  onDeleteHexagon,
  onAddFromFile,
  contextLabel,
  onRenameContext,
  onCreateLink,
}: {
  open: boolean
  onToggle: () => void
  onPrune: OnPrune
  onAddHexagon: () => void
  onDeleteHexagon: () => void
  /** Imports the chosen file's one hexagon (IMP-01); `opener` is whatever had focus when the destination was
   * chosen — the trigger below — so the caller can restore it after a conversion question (CONV-02.1). */
  onAddFromFile: (file: File, context: Destination, opener: HTMLElement | null) => void
  /** The current hexagon's own bounded context, for the import menu's "Import into {context}" choice. */
  contextLabel: string
  /** Reports a context rename/clear session (focus → blur) that actually changed the name, with the map from
   * just before it started — the toast/undo snapshot (NAME-03). Not called when a blur never changed anything. */
  onRenameContext: (before: HexaMap, contextId: string) => void
  /** Creates a map-level link from the Links section's own create form — the second of the two entry points
   * ADR-02 requires to share one write path with the canvas "Link to…" chip. */
  onCreateLink: (from: LinkEnd, to: LinkEnd) => void
}) {
  const map = useMapStore((s) => s.map)
  const hexId = useMapStore((s) => s.focus)
  const d = diagramOf(map, hexId)
  const labels = KINDS[d.kind].labels
  const adaptersOn = adaptersBySide(d)
  const sideLabel: Record<Side, string> = { driving: labels.drivingPort, driven: labels.drivenPort }
  const currentCell = map.hexagons.find((h) => h.id === hexId)?.cell
  const canGrow = !!currentCell && freeSides(map, currentCell).length > 0
  const canDelete = map.hexagons.length > 1
  const importContext = useRef<Destination>('same')
  const importOpener = useRef<HTMLElement | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  // Keyed by contextId, so renaming two contexts in the same session (unlikely, but never concurrent within one
  // input) each keeps its own pre-edit snapshot from focus to blur.
  const contextRenameBefore = useRef(new Map<string, HexaMap>())

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
            <input value={map.title} onChange={(e) => setMapMeta({ title: e.target.value })} />
          </label>
          <ChoiceMenu
            label="Add hexagon from file…"
            choices={[
              { id: 'same' as const, label: `Import into ${contextLabel}` },
              { id: 'new' as const, label: 'Import into a new bounded context' },
            ]}
            onChoose={(context) => {
              importContext.current = context
              importOpener.current = document.activeElement as HTMLElement | null
              importInputRef.current?.click()
            }}
          />
          <input
            ref={importInputRef}
            type="file"
            accept=".hexa,application/json"
            className="visually-hidden"
            aria-label="Add hexagon from a .hexa file"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0]
              if (file) onAddFromFile(file, importContext.current, importOpener.current)
              e.currentTarget.value = ''
            }}
          />
        </Fold>

        <Fold id="contexts" title="Bounded contexts" count={map.contexts.length}>
          <ul className="items">
            {map.contexts.map((ctx) => {
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
                      if (before && contextName(before, ctx.id) !== contextName(useMapStore.getState().map, ctx.id)) onRenameContext(before, ctx.id)
                    }}
                  />
                </li>
              )
            })}
          </ul>
        </Fold>

        <LinksSection map={map} onCreateLink={onCreateLink} />

        <Fold id="hexagon" title="Hexagon">
          <p className="field-static">
            <span>Bounded context</span>
            <span>{contextLabel}</span>
          </p>
          <label className="field" data-item-id="hexagon">
            <span>Hexagon title</span>
            <input value={d.title} onChange={(e) => setMeta(hexId, { title: e.target.value })} />
          </label>
          <label className="field">
            <span>Subtitle</span>
            <input value={d.subtitle ?? ''} onChange={(e) => setMeta(hexId, { subtitle: e.target.value || undefined })} />
          </label>
          <label className="field" data-item-id="composition">
            <span>Composition root</span>
            <input
              value={d.composition?.name ?? ''}
              placeholder="e.g. composition.ts"
              onChange={(e) => setMeta(hexId, { composition: e.target.value ? { ...d.composition, name: e.target.value } : undefined })}
            />
          </label>
          <HintedButton enabled={canGrow} hintId="no-free-side-hint" hint={NO_FREE_SIDE_HINT} onClick={onAddHexagon}>
            Add hexagon
          </HintedButton>
          <HintedButton enabled={canDelete} hintId="last-hexagon-hint" hint={LAST_HEXAGON_HINT} onClick={onDeleteHexagon}>
            Delete hexagon
          </HintedButton>
        </Fold>

        <Fold id="layers" title="Layers" count={KINDS[d.kind].rings.length}>
          <ul className="items">
            {KINDS[d.kind].rings.map((ring) => {
              const override = d.layers?.[ring.role]
              const setLayer = (patch: { title?: string; subtitle?: string }) =>
                setMeta(hexId, { layers: { ...d.layers, [ring.role]: { ...override, ...patch } } as Diagram['layers'] })
              return (
                <li key={ring.role}>
                  <fieldset className="item layer" data-item-id={`layer:${ring.role}`}>
                    <legend>{ring.name}</legend>
                  <label className="field">
                    <span>Ring title</span>
                    <input value={override?.title ?? ''} placeholder={ring.name} onChange={(e) => setLayer({ title: e.target.value || undefined })} />
                  </label>
                  <label className="field">
                    <span>Subtitle</span>
                    <input value={override?.subtitle ?? ''} placeholder={ring.subtitle ?? 'None'} onChange={(e) => setLayer({ subtitle: e.target.value || undefined })} />
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
          collection="useCases"
          items={d.useCases}
          title="Use cases"
          noun="use case"
          empty="No use cases yet. Add what the application does."
          fields={(item, update) =>
            KINDS[d.kind].shape === 'hexagon' && (
              <label className="field">
                <span>Placement</span>
                <select aria-label="Placement" value={item.placement ?? 'top'} onChange={(e) => update({ placement: e.target.value === 'top' ? undefined : WallSchema.parse(e.target.value) })}>
                  <option value="top">Under the title</option>
                  {WallSchema.options.map((w) => <option key={w} value={w}>{WALL_LABEL[w]}</option>)}
                </select>
              </label>
            )
          }
        />

        <Section
          hexId={hexId}
          map={map}
          onPrune={onPrune}
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
              onClick={() => addPort(hexId, side)}
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
              {KINDS[d.kind].shape === 'hexagon' && (
                <label className="field">
                  <span>Wall</span>
                  <select value={item.wall ?? defaultWall(item.side)} onChange={(e) => update({ wall: WallSchema.parse(e.target.value) })}>
                    {WallSchema.options
                      .filter((w) => DRIVING_WALLS.has(w) === (item.side === 'driving'))
                      .map((w) => <option key={w} value={w}>{WALL_LABEL[w]}</option>)}
                  </select>
                </label>
              )}
              <LinkSelect label="Use case" value={item.useCaseId} options={d.useCases} onChange={(useCaseId) => update({ useCaseId })} />
            </>
          )}
        />

        <Section
          hexId={hexId}
          map={map}
          onPrune={onPrune}
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
