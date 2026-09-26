import { flushSync } from 'react-dom'
import { outerRoleOf } from '../model/rings'
import type { CleanElement, CleanRingRole, CleanSector } from '../model/schema'
import { useCleanStore } from '../model/cleanStore'
import { Fold, revealInEditor } from './Editor'
import { Icon } from './Icon'
import { DependenciesSection, ElementList, EndpointsSection } from './RingedSections'

const { addSector, updateSector, removeSector, addElement, updateElement, removeElement, addDependency, removeDependency, addEndpoint, removeEndpoint } = useCleanStore.getState()

/** A sector's own elements (REQ-04): its "+" is the only way to create one — there is no ring-direct path. An
 * empty sector, with no elements yet, is a valid, displayable state. */
function SectorRow({ sector, elements }: { sector: CleanSector; elements: CleanElement[] }) {
  const add = () => {
    let id = ''
    flushSync(() => {
      id = addElement({ name: 'NewElement', sectorId: sector.id })
    })
    revealInEditor(id, true)
  }
  return (
    <li className="sector" data-item-id={sector.id}>
      <div className="sector-head">
        <input className="name" aria-label="sector name" value={sector.name} onChange={(e) => updateSector(sector.id, { name: e.target.value })} />
        <button type="button" className="icon-button small" aria-label={`Add element to ${sector.name}`} title={`Add element to ${sector.name}`} onClick={add}>
          <Icon name="plus" />
        </button>
        <button
          type="button"
          className="icon-button small remove"
          aria-label={`Remove sector ${sector.name}`}
          title="Remove sector"
          onClick={() => removeSector(sector.id)}
        >
          <Icon name="close" />
        </button>
      </div>
      <ElementList elements={elements} onRename={(id, name) => updateElement(id, { name })} onRemove={removeElement} />
    </li>
  )
}

/** A ring's own sectors (REQ-03): free, user-named, any count including zero — its "+" creates one inline-
 * renamable via its name field, the same idiom OnionEditor's `RingSection` already uses for elements. */
function RingSection({ role, name, sectors, elements }: { role: CleanRingRole; name: string; sectors: CleanSector[]; elements: CleanElement[] }) {
  const add = () => {
    let id = ''
    flushSync(() => {
      id = addSector({ name: 'NewSector', ringRole: role })
    })
    revealInEditor(id, true)
  }
  return (
    <Fold
      id={`ring-${role}`}
      title={name}
      count={sectors.length}
      actions={
        <button type="button" className="icon-button small" aria-label={`Add sector to ${name}`} title={`Add sector to ${name}`} onClick={add}>
          <Icon name="plus" />
        </button>
      }
    >
      {!sectors.length ? (
        <p className="empty">No sectors yet.</p>
      ) : (
        <ul className="items sectors">
          {sectors.map((sector) => (
            <SectorRow key={sector.id} sector={sector} elements={elements.filter((e) => e.sectorId === sector.id)} />
          ))}
        </ul>
      )}
    </Fold>
  )
}

/** Editor-panel analogue for Clean (ADR-02): rings → their sectors → each sector's elements, then Dependencies/
 * Actors/Externals shared with Onion via `RingedSections.tsx` (ADR-01) — `ringRoleOf` here resolves through the
 * element's own sector (ADR-02), never a direct field (Onion's own indirects the other way). */
export function CleanEditor({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const doc = useCleanStore((s) => s.map)
  const sectorById = new Map(doc.sectors.map((s) => [s.id, s]))
  const ringRoleOf = (elementId: string) => {
    const element = doc.elements.find((e) => e.id === elementId)
    return (element && sectorById.get(element.sectorId)?.ringRole) ?? ''
  }
  return (
    <aside className={`island editor${open ? '' : ' is-collapsed'}`} aria-label="Diagram editor">
      <header className="editor-head">
        <h2>{doc.title || 'Untitled architecture'}</h2>
        <button type="button" className="icon-button" aria-expanded={open} aria-controls="clean-editor-body" aria-label={open ? 'Collapse editor' : 'Expand editor'} title={open ? 'Collapse editor' : 'Expand editor'} onClick={onToggle}>
          <Icon name="panel" />
        </button>
      </header>
      <div id="clean-editor-body" className="editor-body" hidden={!open}>
        {doc.rings.map((ring) => (
          <RingSection key={ring.role} role={ring.role} name={ring.name} sectors={doc.sectors.filter((s) => s.ringRole === ring.role)} elements={doc.elements} />
        ))}
        <DependenciesSection elements={doc.elements} dependencies={doc.dependencies} rings={doc.rings} ringRoleOf={ringRoleOf} onAdd={addDependency} onRemove={removeDependency} />
        <EndpointsSection collection="actors" title="Actors" noun="actor" elements={doc.elements} items={doc.actors} outerRole={outerRoleOf(doc.rings)} ringRoleOf={ringRoleOf} onAdd={(patch) => addEndpoint('actors', patch)} onRemove={(id) => removeEndpoint('actors', id)} />
        <EndpointsSection collection="externals" title="Externals" noun="external system" elements={doc.elements} items={doc.externals} outerRole={outerRoleOf(doc.rings)} ringRoleOf={ringRoleOf} onAdd={(patch) => addEndpoint('externals', patch)} onRemove={(id) => removeEndpoint('externals', id)} />
      </div>
    </aside>
  )
}
