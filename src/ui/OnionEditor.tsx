import { flushSync } from 'react-dom'
import { tidyOnionOrder } from '../layout/onion'
import { outerRoleOf } from '../model/rings'
import { kindsFor, ONION_KINDS } from '../model/ringedKinds'
import { elementName, UNTITLED } from '../model/ringedDocument'
import type { OnionFile } from '../model/schema'
import { renameRing as withRingName } from '../model/onionRings'
import { useOnionStore } from '../model/onionStore'
import { revealInEditor } from './Editor'
import { Fold } from './Fold'
import { Icon } from './Icon'
import { DependenciesSection, ElementList, EndpointsSection, kindMessage, RenameField } from './RingedSections'

type EndpointCollection = 'actors' | 'externals'

const { setTitle, renameRing, addRing, removeRing, moveRing, addElement, updateElement, removeElement, addDependency, removeDependency, addEndpoint, removeEndpoint, restore } = useOnionStore.getState()

// A rename only ever touches the one element's `name` — everything else in `doc` is exactly what it was before
// the edit started, so replaying the pre-edit name back onto the CURRENT doc reconstructs the pre-edit snapshot
// without a separate focus-time capture (Editor.tsx's context rename needs one only because renaming there can
// run concurrently with other edits across a whole map; a single input's own focus→blur session cannot).
const withElementName = (doc: OnionFile, id: string, name: string): OnionFile => ({ ...doc, elements: doc.elements.map((e) => (e.id === id ? { ...e, name } : e)) })

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const dependencies = (n: number) => count(n, 'dependency', 'dependencies')

const removedRingMessage = (name: string, r: NonNullable<ReturnType<typeof removeRing>>) =>
  `Removed ${name}.` +
  (r.moved ? ` Moved ${count(r.moved, 'element')} to ${r.into}${r.cleared ? `, clearing ${count(r.cleared, 'kind')}` : ''}.` : '') +
  (r.pruned ? ` Removed ${dependencies(r.pruned)} that pointed outward.` : '')

interface OnionEditorProps {
  open: boolean
  onToggle: () => void
  /** Reports every document-changing action (add/rename/remove element, dependency, actor/external — REQ-09)
   * with the document as it stood just before, so App.tsx can toast it with Undo through the one mechanism it
   * already uses for Hexagonal — the same callback OnionStage receives, so the canvas's own "+"s and Depend-on
   * gesture toast through that identical path (ADR-02: one write path, one undo path). */
  onMutate?: (message: string, before: OnionFile) => void
}

/** A ring: its renamable name, the controls that reshape it (only a middle ring can move or go — the innermost
 * and outermost stay), an "add element to this ring" +, and each element's inline-renamable name plus a remove
 * button — the same card idiom Editor.tsx's Section uses for a single flat collection. */
function RingSection({
  index,
  elements,
  doc,
  onMutate,
}: {
  index: number
  elements: OnionFile['elements']
  doc: OnionFile
  onMutate: (message: string, before: OnionFile) => void
}) {
  const { role, name } = doc.rings[index]
  const middle = index > 0 && index < doc.rings.length - 1
  const move = (direction: 'in' | 'out') => {
    const before = doc
    const result = moveRing(role, direction)
    if (!result) return
    onMutate(`Moved ${name} ${direction === 'in' ? 'inward' : 'outward'}.${result.pruned ? ` Removed ${dependencies(result.pruned)} that pointed outward.` : ''}`, before)
  }
  const remove = () => {
    const before = doc
    const result = removeRing(role)
    if (result) onMutate(removedRingMessage(name, result), before)
  }
  const add = () => {
    let id = ''
    const before = doc
    const patch = { name: 'NewElement', ringRole: role }
    flushSync(() => {
      id = addElement(patch)
    })
    onMutate(`Added ${patch.name} to ${name}.`, before)
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
      <div className="ring-settings" data-item-id={role}>
        <label className="field">
          <span>Ring name</span>
          <RenameField ariaLabel="Ring name" value={name} onChange={(next) => renameRing(role, next)} onCommit={(before) => onMutate(`Renamed ${before || 'the ring'} to ${name}.`, withRingName(doc, role, before))} />
        </label>
        {middle && (
          <div className="ring-actions">
            <button type="button" className="text-button small" disabled={index === 1} onClick={() => move('in')} aria-label={`Move ${name} inward`}>
              Move in
            </button>
            <button type="button" className="text-button small" disabled={index === doc.rings.length - 2} onClick={() => move('out')} aria-label={`Move ${name} outward`}>
              Move out
            </button>
            <button type="button" className="text-button small" onClick={remove} aria-label={`Remove ring ${name}`}>
              Remove ring
            </button>
          </div>
        )}
      </div>
      <ElementList
        elements={elements}
        kinds={kindsFor(ONION_KINDS, role)}
        onRename={(id, newName) => updateElement(id, { name: newName })}
        onRenameCommit={(id, before) => onMutate(`Renamed ${before || 'the element'} to ${elementName(doc.elements, id)}.`, withElementName(doc, id, before))}
        onKind={(id, kind) => {
          const before = useOnionStore.getState().map
          updateElement(id, { kind })
          if (useOnionStore.getState().map !== before) onMutate(kindMessage(elementName(doc.elements, id), kind), before)
        }}
        onRemove={(id) => {
          const removedName = elementName(doc.elements, id)
          const before = doc
          removeElement(id)
          onMutate(`Deleted ${removedName}.`, before)
        }}
      />
    </Fold>
  )
}

/** Editor-panel analogue for Onion (ADR-02): rings, dependencies, actors and externals — the Dependencies/
 * Endpoints sections are shared with Clean via `RingedSections.tsx` (ADR-01); `ringRoleOf` here is a direct field
 * read since Onion elements carry their own ring role (Clean's own indirects through its sector, ADR-02). */
export function OnionEditor({ open, onToggle, onMutate = () => {} }: OnionEditorProps) {
  const doc = useOnionStore((s) => s.map)
  const title = doc.title || UNTITLED
  const ringRoleOf = (elementId: string) => doc.elements.find((e) => e.id === elementId)?.ringRole ?? ''

  const handleAddEndpoint = (collection: EndpointCollection, patch: { name: string; targetId: string }) => {
    const before = doc
    const id = addEndpoint(collection, patch)
    if (id) onMutate(`Added ${patch.name} for ${elementName(doc.elements, patch.targetId)}.`, before)
  }
  const handleRemoveEndpoint = (collection: EndpointCollection, id: string) => {
    const item = doc[collection].find((e) => e.id === id)
    if (!item) return
    const before = doc
    removeEndpoint(collection, id)
    onMutate(`Removed ${item.name}.`, before)
  }

  const handleAddRing = () => {
    const before = doc
    let role = ''
    flushSync(() => {
      role = addRing('New ring')
    })
    onMutate('Added the ring New ring.', before)
    revealInEditor(role, true)
  }

  // Decision 3, now explicit rather than automatic (ADR-XX): the author's own ring order is otherwise always
  // respected (`layoutOnion`) — this is the one place it can still be rewritten, and only on request. A no-op
  // (`tidyOnionOrder` returns `undefined`) when the current order already has no crossings left to reduce, so
  // nothing is reported to Undo for a click that changed nothing.
  const handleTidy = () => {
    const tidied = tidyOnionOrder(doc)
    if (!tidied) return
    restore({ map: tidied })
    onMutate('Tidied ring order.', doc)
  }

  return (
    <aside className={`island editor${open ? '' : ' is-collapsed'}`} aria-label="Diagram editor">
      <header className="editor-head">
        <h2>{title}</h2>
        <button type="button" className="text-button small" title="Reduce dependency-edge crossings by reordering rings" onClick={handleTidy}>
          Tidy ring order
        </button>
        <button type="button" className="icon-button" aria-expanded={open} aria-controls="onion-editor-body" aria-label={open ? 'Collapse editor' : 'Expand editor'} title={open ? 'Collapse editor' : 'Expand editor'} onClick={onToggle}>
          <Icon name="panel" />
        </button>
      </header>
      <div id="onion-editor-body" className="editor-body" hidden={!open}>
        <Fold id="diagram" title="Diagram">
          <label className="field">
            <span>Diagram title</span>
            <RenameField ariaLabel="Diagram title" value={doc.title} onChange={setTitle} onCommit={(before) => onMutate(`Renamed ${before || UNTITLED} to ${title}.`, { ...doc, title: before })} />
          </label>
        </Fold>
        {doc.rings.map((ring, i) => (
          <RingSection key={ring.role} index={i} elements={doc.elements.filter((e) => e.ringRole === ring.role)} doc={doc} onMutate={onMutate} />
        ))}
        <button type="button" className="text-button small add-ring" onClick={handleAddRing}>
          Add ring
        </button>
        <DependenciesSection
          elements={doc.elements}
          dependencies={doc.dependencies}
          rings={doc.rings}
          ringRoleOf={ringRoleOf}
          onAdd={(fromId, toId) => {
            const before = doc
            const id = addDependency(fromId, toId)
            if (id) onMutate(`Linked ${elementName(doc.elements, fromId)} → ${elementName(doc.elements, toId)}.`, before)
          }}
          onRemove={(id) => {
            const dep = doc.dependencies.find((d) => d.id === id)
            if (!dep) return
            const before = doc
            removeDependency(id)
            onMutate(`Deleted the dependency ${elementName(doc.elements, dep.fromId)} → ${elementName(doc.elements, dep.toId)}.`, before)
          }}
        />
        <EndpointsSection collection="actors" title="Actors" noun="actor" elements={doc.elements} items={doc.actors} outerRole={outerRoleOf(doc.rings)} ringRoleOf={ringRoleOf} onAdd={(patch) => handleAddEndpoint('actors', patch)} onRemove={(id) => handleRemoveEndpoint('actors', id)} />
        <EndpointsSection collection="externals" title="Externals" noun="external system" elements={doc.elements} items={doc.externals} outerRole={outerRoleOf(doc.rings)} ringRoleOf={ringRoleOf} onAdd={(patch) => handleAddEndpoint('externals', patch)} onRemove={(id) => handleRemoveEndpoint('externals', id)} />
      </div>
    </aside>
  )
}
