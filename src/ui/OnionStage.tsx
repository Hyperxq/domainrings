import { useState, type Ref } from 'react'
import type { LayoutMode } from '../layout/layout'
import type { OnionLayoutModel } from '../layout/onion'
import { onionInsertionItem, onionInsertionPoints, type OnionInsertionPoint } from '../layout/onionInsertion'
import { legendForOnion } from '../layout/legend'
import { classifyRef, elementName } from '../model/ringedDocument'
import { useOnionStore } from '../model/onionStore'
import type { OnionFile } from '../model/schema'
import { OnionDiagram } from '../render/OnionDiagram'
import { affordanceVisible, DependChip, InlineNameField, PlusGlyph, RingedStage, useDependGesture } from './RingedCanvas'

const { addElement, updateElement, removeElement, removeEndpoint, addDependency, addEndpoint } = useOnionStore.getState()

interface OnionStageProps {
  model: OnionLayoutModel
  doc: OnionFile
  /** Overview/Detailed toolbar switch (Decision 1) — threaded down to `OnionDiagram`, which decides which
   * dependency arrows to draw and whether to curve them. */
  mode: LayoutMode
  svgRef: Ref<SVGSVGElement>
  /** Reports why a click while linking was refused, for the app's own toast/notice mechanism (REQ-04). */
  onReject: (message: string) => void
  /** Reports every document-changing action (add element/endpoint, dependency — REQ-09) with the document as it
   * stood just before, so App.tsx can toast it with Undo through the one mechanism it already uses for
   * Hexagonal — the same callback OnionEditor receives, so the "Depend on…" gesture toasts identically whether
   * it started from the canvas or the editor's own create form (ADR-02). */
  onMutate?: (message: string, before: OnionFile) => void
  /** Clears whatever toast is up without offering it as an undo step — fires only when a freshly created
   * element's naming is cancelled, mirroring App.tsx's own `onNamingCancel` for a grown hexagon: the add already
   * unwound (via `removeElement` below), so the toast that announced it must go too, not linger on a state that
   * no longer exists. */
  onCancelMutate?: () => void
  /** Fires once a new element's name is committed: the name belongs to the add step already reported, not a step of its own. */
  onNamed?: () => void
  /** Whether the OnionEditor/Legend islands are open — reserves their own screen space so a fit never tucks the
   * diagram under them (`RingedStage`/`viewport.ts`'s `islandInset`). */
  panelOpen?: boolean
  legendOpen?: boolean
}

const REJECT_MESSAGE = 'A dependency can only point to the same ring or a more inward one.'

/** Canvas analogue for Onion (ADR-02): the diagram, its ring/endpoint "+" affordances (REQ-05, REQ-07), and the
 * "Depend on…" gesture (REQ-04) — shared with Clean via `RingedCanvas.tsx` (ADR-01): select an element, choose
 * another in the same or a more inward ring; a valid target is marked with `data-link-target` while linking
 * (same convention Hexagonal's own link mode uses), and choosing one that is not valid cancels the gesture and
 * reports why via `onReject`, leaving the document unchanged either way. */
export function OnionStage({ model, doc, mode, svgRef, onReject, onMutate = () => {}, onCancelMutate = () => {}, onNamed = () => {}, panelOpen = false, legendOpen = false }: OnionStageProps) {
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const legend = legendForOnion(doc)
  const { selected, linking, setLinking, selectedElement, validTargets, linkTargetRefs, clickTarget } = useDependGesture({
    elements: model.elements,
    rings: doc.rings,
    onCreate: (fromId, toId) => {
      const before = doc
      const id = addDependency(fromId, toId)
      if (id) onMutate(`Linked ${elementName(doc.elements, fromId)} → ${elementName(doc.elements, toId)}.`, before)
    },
    onReject,
    rejectMessage: REJECT_MESSAGE,
  })
  // The "+" that just created `editing`'s element hasn't been laid out yet on this render; its own next render
  // carries the real position, so the inline field re-reads it from the (now current) model every render.
  const editingElement = editing && model.elements.find((e) => e.ref === editing.id)

  // Delete/Backspace (RingedStage) act on whatever `selected` names — an element or an actor/external — going
  // through the same store removals (and the same toast/Undo mechanism) the editor panel's own remove buttons use.
  const deleteSelected = () => {
    if (!selected) return
    const found = classifyRef(doc, selected)
    if (!found) return
    const before = doc
    if (found.collection === 'elements') removeElement(selected)
    else removeEndpoint(found.collection, selected)
    onMutate(`Deleted ${found.name}.`, before)
    clickTarget(null)
  }

  const pick = (point: OnionInsertionPoint) => {
    const item = onionInsertionItem(point.action)
    const before = doc
    if (item.kind === 'element') {
      const id = addElement(item.patch, item.beforeId)
      const ringName = doc.rings.find((r) => r.role === item.patch.ringRole)!.name
      onMutate(`Added ${item.patch.name} to ${ringName}.`, before)
      setEditing({ id, name: item.patch.name })
    } else {
      const id = addEndpoint(item.collection, item.patch)
      if (id) onMutate(`Added ${item.patch.name} for ${elementName(doc.elements, item.patch.targetId)}.`, before)
    }
  }

  return (
    <RingedStage
      bounds={model.bounds}
      ariaLabel={doc.title || 'Onion diagram'}
      svgRef={svgRef}
      linking={linking}
      selected={selected}
      onDelete={deleteSelected}
      panelOpen={panelOpen}
      legendOpen={legendOpen}
      onClick={(e) => clickTarget((e.target as Element).closest('.node')?.getAttribute('data-ref') ?? null)}
      overlay={
        editing &&
        editingElement && (
          <InlineNameField
            defaultValue={editing.name}
            onCommit={(name) => {
              updateElement(editing.id, { name })
              onNamed()
              setEditing(null)
            }}
            onCancel={() => {
              removeElement(editing.id)
              setEditing(null)
              onCancelMutate()
            }}
          />
        )
      }
    >
      {(hover) => (
        <>
          <OnionDiagram model={model} selected={selected} interactive validTargets={linkTargetRefs} legend={legend} mode={mode} hoverRef={hover.ref} />
          {onionInsertionPoints(model, doc)
            .filter((point) => affordanceVisible(point, hover))
            .map((point) => (
              <PlusGlyph key={point.key} point={point} onPick={() => pick(point)} />
            ))}
          {selectedElement && !linking && validTargets.length > 0 && (
            <DependChip x={selectedElement.x} y={selectedElement.y} name={selectedElement.name} onLink={() => setLinking(true)} />
          )}
        </>
      )}
    </RingedStage>
  )
}
