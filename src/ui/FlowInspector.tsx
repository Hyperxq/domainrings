import { Fragment, useId, useState, type KeyboardEvent, type ReactNode } from 'react'
import { linkTargets } from '../model/links'
import { diagramOf } from '../model/map'
import { defaultWall, type Side } from '../model/schema'
import { useMapStore } from '../model/store'
import { session } from './editor/fieldSession'
import { Icon } from './Icon'
import { useHistoryStore } from './state/historyStore'
import { usePreferencesStore } from './state/preferencesStore'
import { useViewStore } from './state/viewStore'

const { addItem, updateItem } = useMapStore.getState()
const { record } = useHistoryStore.getState()

type Field = 'useCaseId' | 'portId' | 'adapterId'

/** The use case Edit mode's inspector edits: the focused flow, outside View mode. */
export function useInspectedFlow() {
  const viewOnly = usePreferencesStore((s) => s.viewOnly)
  const id = useViewStore((s) => s.focusedFlow)
  const useCase = useMapStore((s) => diagramOf(s.map, s.focus).useCases.find((u) => u.id === id))
  return viewOnly ? undefined : useCase
}

const Chip = ({ children }: { children: ReactNode }) => <span className="flow-chip">{children}</span>
const Arrow = () => <span className="flow-arrow" aria-hidden="true">→</span>
const Then = ({ named }: { named: Named[] }) => named.map(({ id, name }) => <Fragment key={id}><Arrow /><Chip>{name}</Chip></Fragment>)

interface Named { id: string; name: string }

/** Enter adds what was typed; `options` are the existing items it would link instead of creating. `onAdd` returns why a name was refused: the text stays, with the reason beneath it. */
function AddName({ label, placeholder, options, onAdd }: { label: string; placeholder: string; options: Named[]; onAdd: (name: string) => string | undefined }) {
  const list = useId()
  const hint = useId()
  const [refusal, setRefusal] = useState<string>()
  return (
    <>
      <input
        className="flow-add"
        aria-label={label}
        placeholder={placeholder}
        list={list}
        aria-invalid={refusal ? true : undefined}
        aria-describedby={refusal ? hint : undefined}
        onChange={() => setRefusal(undefined)}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key !== 'Enter') return
          const reason = onAdd(e.currentTarget.value)
          setRefusal(reason)
          if (!reason) e.currentTarget.value = ''
        }}
      />
      {refusal && <p id={hint} className="hint">{refusal}</p>}
      <datalist id={list}>{options.map(({ id, name }) => <option key={id} value={name} />)}</datalist>
    </>
  )
}

/** Edit mode's right island: the focused flow's name, text, entries and calls, edited in place. */
export function FlowInspector() {
  const useCase = useInspectedFlow()
  const map = useMapStore((s) => s.map)
  const hexId = useMapStore((s) => s.focus)
  const focusFlow = useViewStore((s) => s.focusFlow)
  if (!useCase) return null
  const d = diagramOf(map, hexId)
  const before = { map, focus: hexId }
  const typed = (patch: { name?: string; description?: string }) => updateItem(hexId, 'useCases', useCase.id, patch)

  // Typing a name links an existing item of that name when it may be linked there, else creates it already linked.
  // Names are not unique, so a same-named item that cannot be linked here (the wrong side) does not stop a new one.
  const connect = (key: 'ports' | 'adapters' | 'actors', field: Field, name: string, targetId: string, extra: { side?: Side; wall?: ReturnType<typeof defaultWall> } = {}) => {
    const wanted = name.trim()
    if (!wanted) return 'Type a name first'
    const items: (Named & { side?: Side } & Partial<Record<Field, string>>)[] = d[key]
    const same = items.filter((i) => i.name.toLowerCase() === wanted.toLowerCase() && (!extra.side || i.side === extra.side))
    const hit = same.find((i) => linkTargets(d, i.id).some((t) => t.targetRef === targetId))
    if (!hit && same.some((i) => i[field] === targetId)) return 'Already in this flow'
    record(before)
    if (hit) updateItem(hexId, key, hit.id, { [field]: targetId } as never)
    else addItem(hexId, key, { name: wanted, [field]: targetId, ...extra } as never)
  }
  const free = (key: 'ports' | 'adapters' | 'actors', targetId: string, side?: Side): Named[] =>
    d[key].filter((i) => (!side || ('side' in i && i.side === side)) && linkTargets(d, i.id).some((t) => t.targetRef === targetId))

  const entries = d.ports.filter((p) => p.side === 'driving' && p.useCaseId === useCase.id)
  const calls = d.ports.filter((p) => p.side === 'driven' && p.useCaseId === useCase.id)
  const destinations = (portId: string): Named[] => [
    ...d.adapters.filter((a) => a.portId === portId).flatMap((a) => d.externals.filter((e) => e.adapterId === a.id)),
    ...map.links
      .filter((l) => l.from.hexagonId === hexId && l.from.portId === portId)
      .flatMap((l) => {
        const target = map.hexagons.find((h) => h.id === l.to.hexagonId)
        const port = target?.ports.find((p) => p.id === l.to.portId)
        return target && port ? [{ id: l.id, name: `${target.title} · ${port.name}` }] : []
      }),
  ]

  return (
    <aside className="island editor flow-inspector" aria-label="Flow inspector">
      <header className="editor-head">
        <span className="flow-dot" aria-hidden="true" />
        <input className="name" aria-label="Flow name" value={useCase.name} onChange={(e) => typed({ name: e.target.value })} {...session} />
        <button type="button" className="icon-button small" aria-label="Close flow" title="Close flow" onClick={() => focusFlow(null)}>
          <Icon name="close" />
        </button>
      </header>
      <div className="editor-body">
        <label className="field">
          <span>What it does</span>
          <textarea rows={2} placeholder="Describe this flow in a sentence" value={useCase.description ?? ''} onChange={(e) => typed({ description: e.target.value || undefined })} {...session} />
        </label>

        <h3 className="flow-step">1 · WHO STARTS IT</h3>
        <ul className="flow-list" aria-label="Who starts it">
          {entries.map((port) => {
            const adapters = d.adapters.filter((a) => a.portId === port.id)
            return (
              <li key={port.id}>
                {adapters.map((adapter) => (
                  <div key={adapter.id} className="flow-chain">
                    {d.actors.filter((a) => a.adapterId === adapter.id).map((a) => <Chip key={a.id}>{a.name}</Chip>)}
                    <AddName label={`Add actor to ${adapter.name}`} placeholder="+ actor" options={free('actors', adapter.id)} onAdd={(name) => connect('actors', 'adapterId', name, adapter.id)} />
                    <Arrow />
                    <Chip>{adapter.name}</Chip>
                    <Arrow />
                    <Chip>{port.name}</Chip>
                  </div>
                ))}
                {!adapters.length && <div className="flow-chain"><Chip>{port.name}</Chip></div>}
                <AddName label={`Add adapter to ${port.name}`} placeholder="+ adapter" options={free('adapters', port.id)} onAdd={(name) => connect('adapters', 'portId', name, port.id)} />
              </li>
            )
          })}
        </ul>
        <AddName label="Add a way in" placeholder="type a port name" options={free('ports', useCase.id, 'driving')} onAdd={(name) => connect('ports', 'useCaseId', name, useCase.id, { side: 'driving', wall: defaultWall('driving') })} />

        <h3 className="flow-step">2 · WHAT IT DECIDES WITH</h3>
        <p className="flows-help">Available once use cases can list their aggregates.</p>

        <h3 className="flow-step">3 · WHAT IT CALLS</h3>
        <ul className="flow-list" aria-label="What it calls">
          {calls.map((port) => (
            <li key={port.id}>
              <div className="flow-chain">
                <Chip>{port.name}</Chip>
                <Then named={d.adapters.filter((a) => a.portId === port.id)} />
                <Then named={destinations(port.id)} />
              </div>
              <input className="flow-verb" aria-label={`Verb for ${port.name}`} placeholder="verb" value={port.verb ?? ''} onChange={(e) => updateItem(hexId, 'ports', port.id, { verb: e.target.value || undefined })} {...session} />
              <button
                type="button"
                className="icon-button small"
                aria-label={`Remove call ${port.name}`}
                title="Remove call"
                onClick={() => {
                  record(before)
                  updateItem(hexId, 'ports', port.id, { useCaseId: undefined })
                }}
              >
                <Icon name="close" />
              </button>
            </li>
          ))}
        </ul>
        <AddName label="Add a call" placeholder="+ Add a call · type a port name" options={free('ports', useCase.id, 'driven')} onAdd={(name) => connect('ports', 'useCaseId', name, useCase.id, { side: 'driven', wall: defaultWall('driven') })} />

        <p className="flows-help">Typing a name that doesn't exist yet creates it. Position on the diagram is automatic.</p>
      </div>
    </aside>
  )
}
