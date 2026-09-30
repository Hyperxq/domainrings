import { flushSync } from 'react-dom'
import { tidyCleanOrder } from '../layout/clean'
import { outerRoleOf } from '../model/rings'
import { CLEAN_KINDS } from '../model/ringedKinds'
import { elementName, UNTITLED } from '../model/ringedDocument'
import type { CleanElement, CleanFile, CleanRingRole, CleanSector } from '../model/schema'
import { useCleanStore } from '../model/cleanStore'
import { Fold } from './Fold'
import { Icon } from './Icon'
import { revealInEditor } from './revealInEditor'
import { DependenciesSection, ElementList, EndpointsSection, kindMessage, RenameField } from './RingedSections'

type EndpointCollection = 'actors' | 'externals'

const { setTitle, addSector, updateSector, removeSector, addElement, updateElement, removeElement, addDependency, removeDependency, addEndpoint, removeEndpoint, restore } = useCleanStore.getState()

// See OnionEditor's own `withElementName` for why replaying the pre-edit string back onto the CURRENT doc is a
// sound reconstruction of the pre-edit snapshot (a rename session never overlaps any other edit).
const withElementName = (doc: CleanFile, id: string, name: string): CleanFile => ({ ...doc, elements: doc.elements.map((e) => (e.id === id ? { ...e, name } : e)) })
const withSectorName = (doc: CleanFile, id: string, name: string): CleanFile => ({ ...doc, sectors: doc.sectors.map((s) => (s.id === id ? { ...s, name } : s)) })

interface CleanEditorProps {
  open: boolean
  onToggle: () => void
  /** Reports every document-changing action (add/rename/remove sector or element, dependency, actor/external —
   * REQ-09) with the document as it stood just before, so App.tsx can toast it with Undo through the one
   * mechanism it already uses for Hexagonal — the same callback CleanStage receives (ADR-02). */
  onMutate?: (message: string, before: CleanFile) => void
}

/** A sector's own elements (REQ-04): its "+" is the only way to create one — there is no ring-direct path. An
 * empty sector, with no elements yet, is a valid, displayable state. */
function SectorRow({
  sector,
  elements,
  doc,
  onMutate,
}: {
  sector: CleanSector
  elements: CleanElement[]
  doc: CleanFile
  onMutate: (message: string, before: CleanFile) => void
}) {
  const add = () => {
    let id = ''
    const before = doc
    const patch = { name: 'NewElement', sectorId: sector.id }
    flushSync(() => {
      id = addElement(patch)
    })
    onMutate(`Added ${patch.name} to ${sector.name}.`, before)
    revealInEditor(id, true)
  }
  return (
    <li className="sector" data-item-id={sector.id}>
      <div className="sector-head">
        <RenameField
          ariaLabel="sector name"
          value={sector.name}
          onChange={(name) => updateSector(sector.id, { name })}
          onCommit={(before) => onMutate(`Renamed ${before || 'the sector'} to ${sector.name}.`, withSectorName(doc, sector.id, before))}
        />
        <button type="button" className="icon-button small" aria-label={`Add element to ${sector.name}`} title={`Add element to ${sector.name}`} onClick={add}>
          <Icon name="plus" />
        </button>
        <button
          type="button"
          className="icon-button small remove"
          aria-label={`Remove sector ${sector.name}`}
          title="Remove sector"
          onClick={() => {
            const before = doc
            const count = elements.length
            removeSector(sector.id)
            const plural = count === 1 ? '' : 's'
            onMutate(count ? `Deleted ${sector.name} and its ${count} element${plural}.` : `Deleted ${sector.name}.`, before)
          }}
        >
          <Icon name="close" />
        </button>
      </div>
      <ElementList
        elements={elements}
        kinds={CLEAN_KINDS[sector.ringRole]}
        onRename={(id, newName) => updateElement(id, { name: newName })}
        onRenameCommit={(id, before) => onMutate(`Renamed ${before || 'the element'} to ${elementName(doc.elements, id)}.`, withElementName(doc, id, before))}
        onKind={(id, kind) => {
          const before = useCleanStore.getState().map
          updateElement(id, { kind })
          if (useCleanStore.getState().map !== before) onMutate(kindMessage(elementName(doc.elements, id), kind), before)
        }}
        onRemove={(id) => {
          const removedName = elementName(doc.elements, id)
          const before = doc
          removeElement(id)
          onMutate(`Deleted ${removedName}.`, before)
        }}
      />
    </li>
  )
}

/** A ring's own sectors (REQ-03): free, user-named, any count including zero — its "+" creates one inline-
 * renamable via its name field, the same idiom OnionEditor's `RingSection` already uses for elements. */
function RingSection({
  role,
  name,
  sectors,
  elements,
  doc,
  onMutate,
}: {
  role: CleanRingRole
  name: string
  sectors: CleanSector[]
  elements: CleanElement[]
  doc: CleanFile
  onMutate: (message: string, before: CleanFile) => void
}) {
  const add = () => {
    let id = ''
    const before = doc
    const patch = { name: 'NewSector', ringRole: role }
    flushSync(() => {
      id = addSector(patch)
    })
    onMutate(`Added ${patch.name} to ${name}.`, before)
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
            <SectorRow key={sector.id} sector={sector} elements={elements.filter((e) => e.sectorId === sector.id)} doc={doc} onMutate={onMutate} />
          ))}
        </ul>
      )}
    </Fold>
  )
}

/** Editor-panel analogue for Clean (ADR-02): rings → their sectors → each sector's elements, then Dependencies/
 * Actors/Externals shared with Onion via `RingedSections.tsx` (ADR-01) — `ringRoleOf` here resolves through the
 * element's own sector (ADR-02), never a direct field (Onion's own indirects the other way). */
export function CleanEditor({ open, onToggle, onMutate = () => {} }: CleanEditorProps) {
  const doc = useCleanStore((s) => s.map)
  const title = doc.title || UNTITLED
  const sectorById = new Map(doc.sectors.map((s) => [s.id, s]))
  const ringRoleOf = (elementId: string) => {
    const element = doc.elements.find((e) => e.id === elementId)
    return (element && sectorById.get(element.sectorId)?.ringRole) ?? ''
  }

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

  // Decision 3, now explicit rather than automatic (ADR-XX): the author's own sector order is otherwise always
  // respected (`layoutClean`) — this is the one place it can still be rewritten, and only on request. A no-op
  // (`tidyCleanOrder` returns `undefined`) when the current order already has no crossings left to reduce, so
  // nothing is reported to Undo for a click that changed nothing.
  const handleTidy = () => {
    const tidied = tidyCleanOrder(doc)
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
        <button type="button" className="icon-button" aria-expanded={open} aria-controls="clean-editor-body" aria-label={open ? 'Collapse editor' : 'Expand editor'} title={open ? 'Collapse editor' : 'Expand editor'} onClick={onToggle}>
          <Icon name="panel" />
        </button>
      </header>
      <div id="clean-editor-body" className="editor-body" hidden={!open}>
        <Fold id="diagram" title="Diagram">
          <label className="field">
            <span>Diagram title</span>
            <RenameField ariaLabel="Diagram title" value={doc.title} onChange={setTitle} onCommit={(before) => onMutate(`Renamed ${before || UNTITLED} to ${title}.`, { ...doc, title: before })} />
          </label>
        </Fold>
        {doc.rings.map((ring) => (
          <RingSection key={ring.role} role={ring.role} name={ring.name} sectors={doc.sectors.filter((s) => s.ringRole === ring.role)} elements={doc.elements} doc={doc} onMutate={onMutate} />
        ))}
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
