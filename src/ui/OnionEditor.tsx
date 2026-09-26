import { useState } from 'react'
import { flushSync } from 'react-dom'
import { isInwardOrSame, outerRoleOf } from '../model/rings'
import type { OnionFile, OnionRingRole } from '../model/schema'
import { useOnionStore } from '../model/onionStore'
import { Fold, revealInEditor } from './Editor'
import { Icon } from './Icon'

const { addElement, updateElement, removeElement, addDependency, removeDependency, addEndpoint, removeEndpoint } = useOnionStore.getState()

/** A ring's own elements (REQ-07): its name, an "add element to this ring" +, and each element's inline-renamable
 * name plus a remove button — the same card idiom Editor.tsx's Section uses for a single flat collection. */
function RingSection({ role, name, elements }: { role: OnionRingRole; name: string; elements: OnionFile['elements'] }) {
  const add = () => {
    let id = ''
    flushSync(() => {
      id = addElement({ name: 'NewElement', ringRole: role })
    })
    revealInEditor(id, true)
  }
  return (
    <Fold
      id={`ring-${role}`}
      title={name}
      count={elements.length}
      actions={
        <button type="button" className="icon-button small" aria-label={`Add element to ${name}`} title={`Add element to ${name}`} onClick={add}>
          <Icon name="plus" />
        </button>
      }
    >
      {!elements.length ? (
        <p className="empty">No elements yet.</p>
      ) : (
        <ul className="items">
          {elements.map((element) => (
            <li key={element.id} className="item" data-item-id={element.id}>
              <input className="name" aria-label="element name" value={element.name} onChange={(e) => updateElement(element.id, { name: e.target.value })} />
              <button
                type="button"
                className="icon-button small remove"
                aria-label={`Remove element ${element.name}`}
                title="Remove element"
                onClick={() => removeElement(element.id)}
              >
                <Icon name="close" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Fold>
  )
}

/** The dependency create form (REQ-04): "To element" only ever offers targets `isInwardOrSame` accepts, so the
 * rejected-outward gesture is never reachable from here (the canvas gesture in OnionStage is what exercises the
 * store's own rejection). */
function DependenciesSection({ doc }: { doc: OnionFile }) {
  const [fromId, setFromId] = useState<string | undefined>(undefined)
  const [toId, setToId] = useState<string | undefined>(undefined)
  const elementName = (id: string) => doc.elements.find((e) => e.id === id)?.name ?? ''
  const fromElement = doc.elements.find((e) => e.id === fromId)
  const validTargets = fromElement ? doc.elements.filter((e) => e.id !== fromElement.id && isInwardOrSame(doc.rings, fromElement.ringRole, e.ringRole)) : []
  const submit = () => {
    if (!fromId || !toId) return
    addDependency(fromId, toId)
    setFromId(undefined)
    setToId(undefined)
  }
  return (
    <Fold id="dependencies" title="Dependencies" count={doc.dependencies.length}>
      {!doc.dependencies.length ? (
        <p className="empty">No dependencies yet. Connect an element to one in the same or a more inward ring.</p>
      ) : (
        <ul className="items">
          {doc.dependencies.map((dep) => (
            <li key={dep.id} className="item" data-item-id={dep.id}>
              <span className="link-row-label">
                {elementName(dep.fromId)} → {elementName(dep.toId)}
              </span>
              <button
                type="button"
                className="icon-button small remove"
                aria-label={`Delete dependency ${elementName(dep.fromId)} to ${elementName(dep.toId)}`}
                title="Delete dependency"
                onClick={() => removeDependency(dep.id)}
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
            {doc.elements.map((el) => (
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

/** An actors or externals create form (REQ-05): the target select only ever lists outer-ring elements, so a
 * non-outer target is never reachable from here. */
function EndpointsSection({ collection, title, noun, doc }: { collection: 'actors' | 'externals'; title: string; noun: string; doc: OnionFile }) {
  const outerRole = outerRoleOf(doc.rings)
  const outerElements = doc.elements.filter((e) => e.ringRole === outerRole)
  const items = doc[collection]
  const elementName = (id?: string) => (id ? doc.elements.find((e) => e.id === id)?.name : undefined) ?? ''
  const [targetId, setTargetId] = useState<string | undefined>(undefined)
  const submit = () => {
    if (!targetId) return
    addEndpoint(collection, { name: collection === 'actors' ? 'New actor' : 'New system', targetId })
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
                onClick={() => removeEndpoint(collection, item.id)}
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

/** Editor-panel analogue for Onion (ADR-02): rings, dependencies, actors and externals — never imports
 * `model/map`, since nothing here has a Hexagonal counterpart to share. */
export function OnionEditor({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const doc = useOnionStore((s) => s.map)
  return (
    <aside className={`island editor${open ? '' : ' is-collapsed'}`} aria-label="Diagram editor">
      <header className="editor-head">
        <h2>{doc.title || 'Untitled architecture'}</h2>
        <button type="button" className="icon-button" aria-expanded={open} aria-controls="onion-editor-body" aria-label={open ? 'Collapse editor' : 'Expand editor'} title={open ? 'Collapse editor' : 'Expand editor'} onClick={onToggle}>
          <Icon name="panel" />
        </button>
      </header>
      <div id="onion-editor-body" className="editor-body" hidden={!open}>
        {doc.rings.map((ring) => (
          <RingSection key={ring.role} role={ring.role} name={ring.name} elements={doc.elements.filter((e) => e.ringRole === ring.role)} />
        ))}
        <DependenciesSection doc={doc} />
        <EndpointsSection collection="actors" title="Actors" noun="actor" doc={doc} />
        <EndpointsSection collection="externals" title="Externals" noun="external system" doc={doc} />
      </div>
    </aside>
  )
}
