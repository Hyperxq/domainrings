import { useState } from 'react'
import { isInwardOrSame } from '../model/rings'
import { Fold } from './Editor'
import { Icon } from './Icon'

interface RingedElement {
  id: string
  name: string
}
interface RingedDependency {
  id: string
  fromId: string
  toId: string
}
interface RingedEndpoint {
  id: string
  name: string
  targetId?: string
}

/** A flat element list's own card idiom — inline-renamable name plus a remove button, or an empty-state message.
 * Extracted from what was a character-for-character duplicate of Onion's `RingSection` (ring-level list) and
 * Clean's `SectorRow` (sector-level list) — both wrap it in their own container, only the elements shown differ. */
export function ElementList({
  elements,
  onRename,
  onRemove,
}: {
  elements: readonly RingedElement[]
  onRename: (id: string, name: string) => void
  onRemove: (id: string) => void
}) {
  if (!elements.length) return <p className="empty">No elements yet.</p>
  return (
    <ul className="items">
      {elements.map((element) => (
        <li key={element.id} className="item" data-item-id={element.id}>
          <input className="name" aria-label="element name" value={element.name} onChange={(e) => onRename(element.id, e.target.value)} />
          <button type="button" className="icon-button small remove" aria-label={`Remove element ${element.name}`} title="Remove element" onClick={() => onRemove(element.id)}>
            <Icon name="close" />
          </button>
        </li>
      ))}
    </ul>
  )
}

/** The dependency create form (REQ-04/REQ-06): "To element" only ever offers targets `isInwardOrSame` accepts,
 * so the rejected-outward gesture is never reachable from here (the canvas gesture is what exercises the store's
 * own rejection). Shared by Onion and Clean (ADR-01) — `ringRoleOf` resolves an element's ring role however its
 * own kind stores it (Onion: a direct field; Clean: through its sector, ADR-02), never assumed here. */
export function DependenciesSection({
  elements,
  dependencies,
  rings,
  ringRoleOf,
  onAdd,
  onRemove,
}: {
  elements: readonly RingedElement[]
  dependencies: readonly RingedDependency[]
  rings: readonly { role: string }[]
  ringRoleOf: (elementId: string) => string
  onAdd: (fromId: string, toId: string) => void
  onRemove: (id: string) => void
}) {
  const [fromId, setFromId] = useState<string | undefined>(undefined)
  const [toId, setToId] = useState<string | undefined>(undefined)
  const elementName = (id: string) => elements.find((e) => e.id === id)?.name ?? ''
  const fromElement = elements.find((e) => e.id === fromId)
  const validTargets = fromElement ? elements.filter((e) => e.id !== fromElement.id && isInwardOrSame(rings, ringRoleOf(fromElement.id), ringRoleOf(e.id))) : []
  const submit = () => {
    if (!fromId || !toId) return
    onAdd(fromId, toId)
    setFromId(undefined)
    setToId(undefined)
  }
  return (
    <Fold id="dependencies" title="Dependencies" count={dependencies.length}>
      {!dependencies.length ? (
        <p className="empty">No dependencies yet. Connect an element to one in the same or a more inward ring.</p>
      ) : (
        <ul className="items">
          {dependencies.map((dep) => (
            <li key={dep.id} className="item" data-item-id={dep.id}>
              <span className="link-row-label">
                {elementName(dep.fromId)} → {elementName(dep.toId)}
              </span>
              <button
                type="button"
                className="icon-button small remove"
                aria-label={`Delete dependency ${elementName(dep.fromId)} to ${elementName(dep.toId)}`}
                title="Delete dependency"
                onClick={() => onRemove(dep.id)}
              >
                <Icon name="close" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="link-create">
        <label className="field">
          <span>From element</span>
          <select
            value={fromId ?? ''}
            onChange={(e) => {
              setFromId(e.target.value || undefined)
              setToId(undefined)
            }}
          >
            <option value="">Not chosen</option>
            {elements.map((el) => (
              <option key={el.id} value={el.id}>{el.name}</option>
            ))}
          </select>
        </label>
        {fromElement && (
          <label className="field">
            <span>To element</span>
            <select value={toId ?? ''} onChange={(e) => setToId(e.target.value || undefined)}>
              <option value="">Not chosen</option>
              {validTargets.map((el) => (
                <option key={el.id} value={el.id}>{el.name}</option>
              ))}
            </select>
          </label>
        )}
        <button type="button" className="text-button" disabled={!fromId || !toId} onClick={submit}>
          Create dependency
        </button>
      </div>
    </Fold>
  )
}

/** An actors or externals create form (REQ-05/REQ-07): the target select only ever lists outer-ring elements, so
 * a non-outer target is never reachable from here. Shared by Onion and Clean (ADR-01), same `ringRoleOf`
 * indirection as `DependenciesSection`. */
export function EndpointsSection({
  collection,
  title,
  noun,
  elements,
  items,
  outerRole,
  ringRoleOf,
  onAdd,
  onRemove,
}: {
  collection: 'actors' | 'externals'
  title: string
  noun: string
  elements: readonly RingedElement[]
  items: readonly RingedEndpoint[]
  outerRole: string
  ringRoleOf: (elementId: string) => string
  onAdd: (patch: { name: string; targetId: string }) => void
  onRemove: (id: string) => void
}) {
  const outerElements = elements.filter((e) => ringRoleOf(e.id) === outerRole)
  const elementName = (id?: string) => (id ? elements.find((e) => e.id === id)?.name : undefined) ?? ''
  const [targetId, setTargetId] = useState<string | undefined>(undefined)
  const submit = () => {
    if (!targetId) return
    onAdd({ name: collection === 'actors' ? 'New actor' : 'New system', targetId })
    setTargetId(undefined)
  }
  return (
    <Fold id={collection} title={title} count={items.length}>
      {!items.length ? (
        <p className="empty">No {noun}s yet. Connect one to an outer-ring element.</p>
      ) : (
        <ul className="items">
          {items.map((item) => (
            <li key={item.id} className="item" data-item-id={item.id}>
              <span className="link-row-label">
                {item.name}
                {item.targetId ? ` → ${elementName(item.targetId)}` : ''}
              </span>
              <button
                type="button"
                className="icon-button small remove"
                aria-label={`Remove ${noun} ${item.name}`}
                title={`Remove ${noun}`}
                onClick={() => onRemove(item.id)}
              >
                <Icon name="close" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="link-create">
        <label className="field">
          <span>Target (outer ring)</span>
          <select value={targetId ?? ''} onChange={(e) => setTargetId(e.target.value || undefined)}>
            <option value="">Not chosen</option>
            {outerElements.map((el) => (
              <option key={el.id} value={el.id}>{el.name}</option>
            ))}
          </select>
        </label>
        <button type="button" className="text-button" disabled={!targetId} onClick={submit}>
          Add {noun}
        </button>
      </div>
    </Fold>
  )
}
