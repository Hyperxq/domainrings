import { flushSync } from 'react-dom'
import { outerRoleOf } from '../model/rings'
import type { OnionFile, OnionRingRole } from '../model/schema'
import { useOnionStore } from '../model/onionStore'
import { Fold, revealInEditor } from './Editor'
import { Icon } from './Icon'
import { DependenciesSection, ElementList, EndpointsSection } from './RingedSections'

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
      <ElementList elements={elements} onRename={(id, name) => updateElement(id, { name })} onRemove={removeElement} />
    </Fold>
  )
}

/** Editor-panel analogue for Onion (ADR-02): rings, dependencies, actors and externals — the Dependencies/
 * Endpoints sections are shared with Clean via `RingedSections.tsx` (ADR-01); `ringRoleOf` here is a direct field
 * read since Onion elements carry their own ring role (Clean's own indirects through its sector, ADR-02). */
export function OnionEditor({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const doc = useOnionStore((s) => s.map)
  const ringRoleOf = (elementId: string) => doc.elements.find((e) => e.id === elementId)?.ringRole ?? ''
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
        <DependenciesSection elements={doc.elements} dependencies={doc.dependencies} rings={doc.rings} ringRoleOf={ringRoleOf} onAdd={addDependency} onRemove={removeDependency} />
        <EndpointsSection collection="actors" title="Actors" noun="actor" elements={doc.elements} items={doc.actors} outerRole={outerRoleOf(doc.rings)} ringRoleOf={ringRoleOf} onAdd={(patch) => addEndpoint('actors', patch)} onRemove={(id) => removeEndpoint('actors', id)} />
        <EndpointsSection collection="externals" title="Externals" noun="external system" elements={doc.elements} items={doc.externals} outerRole={outerRoleOf(doc.rings)} ringRoleOf={ringRoleOf} onAdd={(patch) => addEndpoint('externals', patch)} onRemove={(id) => removeEndpoint('externals', id)} />
      </div>
    </aside>
  )
}
