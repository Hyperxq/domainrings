import { useState, type ReactNode } from 'react'
import { KINDS } from '../model/kinds'
import {
  defaultWall,
  DomainTypeSchema,
  DRIVING_WALLS,
  PARENT_TYPES,
  SideSchema,
  WallSchema,
  type CollectionKey,
  type Diagram,
  type Side,
  type Wall,
} from '../model/schema'
import { useDiagramStore, type Item } from '../model/store'
import { Icon } from './Icon'

const { addItem, updateItem, removeItem, setMeta } = useDiagramStore.getState()

type Patch<K extends CollectionKey> = Partial<Omit<Item<K>, 'id'>>

const WALL_LABEL: Record<Wall, string> = { nw: 'North-west', w: 'West', sw: 'South-west', ne: 'North-east', e: 'East', se: 'South-east' }

const FLASH_MS = 1200

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
  add?: { label: string; onAdd: () => void }
  children: ReactNode
}

/** A collapsible editor section, open by default; each one remembers whether it was left open. */
function Fold({ id, title, count, add, children }: FoldProps) {
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
      {add && (
        <button type="button" className="icon-button small section-add" aria-label={add.label} title={add.label} onClick={add.onAdd}>
          <Icon name="plus" />
        </button>
      )}
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

interface SectionProps<K extends CollectionKey> {
  collection: K
  items: Item<K>[]
  title: string
  noun: string
  empty: string
  fields?: (item: Item<K>, update: (patch: Patch<K>) => void) => ReactNode
}

function Section<K extends CollectionKey>({ collection, items, title, noun, empty, fields }: SectionProps<K>) {
  return (
    <Fold id={collection} title={title} count={items.length} add={{ label: `Add ${noun}`, onAdd: () => addItem(collection) }}>
      {items.length ? (
        <ul className="items">
          {items.map((item) => {
            const update = (patch: Patch<K>) => updateItem(collection, item.id, patch)
            return (
              <li key={item.id} className="item" data-item-id={item.id}>
                <input className="name" aria-label={`${noun} name`} value={item.name} onChange={(e) => update({ name: e.target.value } as Patch<K>)} />
                <button type="button" className="icon-button small remove" aria-label={`Remove ${noun} ${item.name}`} title={`Remove ${noun}`} onClick={() => removeItem(collection, item.id)}>
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
      ) : (
        <p className="empty">{empty}</p>
      )}
    </Fold>
  )
}

/** Entities and aggregates that can hold `id` without creating a cycle: never itself or its descendants. */
function parentOptions(domain: Diagram['domain'], id: string) {
  const below = new Set([id])
  for (let grew = true; grew; ) {
    grew = false
    for (const i of domain) {
      if (i.parentId && below.has(i.parentId) && !below.has(i.id)) {
        below.add(i.id)
        grew = true
      }
    }
  }
  return domain.filter((i) => PARENT_TYPES.has(i.type) && !below.has(i.id))
}

function adaptersBySide(d: Diagram) {
  const portSide = new Map(d.ports.map((p) => [p.id, p.side]))
  return (side: Side) => d.adapters.filter((a) => (a.portId ? portSide.get(a.portId) === side : true))
}

export function Editor({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const d = useDiagramStore((s) => s.diagram)
  const labels = KINDS[d.kind].labels
  const adaptersOn = adaptersBySide(d)
  const sideLabel: Record<Side, string> = { driving: labels.drivingPort, driven: labels.drivenPort }

  return (
    <aside className={`island editor${open ? '' : ' is-collapsed'}`} aria-label="Diagram editor">
      <header className="editor-head">
        <h2>Model</h2>
        <button type="button" className="icon-button" aria-expanded={open} aria-controls="editor-body" aria-label={open ? 'Collapse editor' : 'Expand editor'} title={open ? 'Collapse editor' : 'Expand editor'} onClick={onToggle}>
          <Icon name="panel" />
        </button>
      </header>

      <div id="editor-body" className="editor-body" hidden={!open}>
        <Fold id="diagram" title="Diagram">
          <label className="field">
            <span>Title</span>
            <input value={d.title} onChange={(e) => setMeta({ title: e.target.value })} />
          </label>
          <label className="field">
            <span>Subtitle</span>
            <input value={d.subtitle ?? ''} onChange={(e) => setMeta({ subtitle: e.target.value || undefined })} />
          </label>
          <label className="field" data-item-id="composition">
            <span>Composition root</span>
            <input
              value={d.composition?.name ?? ''}
              placeholder="e.g. composition.ts"
              onChange={(e) => setMeta({ composition: e.target.value ? { ...d.composition, name: e.target.value } : undefined })}
            />
          </label>
        </Fold>

        <Fold id="layers" title="Layers" count={KINDS[d.kind].rings.length}>
          <ul className="items">
            {KINDS[d.kind].rings.map((ring) => {
              const override = d.layers?.[ring.role]
              const setLayer = (patch: { title?: string; subtitle?: string }) =>
                setMeta({ layers: { ...d.layers, [ring.role]: { ...override, ...patch } } as Diagram['layers'] })
              return (
                <li key={ring.role}>
                  <fieldset className="item layer" data-item-id={`layer:${ring.role}`}>
                    <legend>{ring.name}</legend>
                  <label className="field">
                    <span>Title</span>
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
              <LinkSelect label="Belongs to" value={item.parentId} options={parentOptions(d.domain, item.id)} onChange={(parentId) => update({ parentId })} />
            </>
          )}
        />

        <Section collection="useCases" items={d.useCases} title="Use cases" noun="use case" empty="No use cases yet. Add what the application does." />

        <Section
          collection="ports"
          items={d.ports}
          title="Ports"
          noun="port"
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
