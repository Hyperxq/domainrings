import { useState, type Ref } from 'react'
import type { CleanLayoutModel } from '../layout/clean'
import type { LayoutMode } from '../layout/layout'
import { cleanInsertionItem, cleanInsertionPoints, type CleanInsertionPoint } from '../layout/cleanInsertion'
import { legendForClean } from '../layout/legend'
import { elementName } from '../model/ringedDocument'
import { useCleanStore } from '../model/cleanStore'
import type { CleanFile } from '../model/schema'
import { CleanDiagram } from '../render/CleanDiagram'
import { affordanceVisible, DependChip, InlineNameField, PlusGlyph, RingedStage, useDependGesture } from './RingedCanvas'

const { addSector, addElement, updateElement, removeElement, addDependency, addEndpoint } = useCleanStore.getState()

interface CleanStageProps {
  model: CleanLayoutModel
  doc: CleanFile
  /** Overview/Detailed toolbar switch (Decision 1) — threaded down to `CleanDiagram`, which decides which
   * dependency arrows to draw and whether to curve them. */
  mode: LayoutMode
  svgRef: Ref<SVGSVGElement>
  /** Reports why a click while linking was refused, for the app's own toast/notice mechanism (REQ-06). */
  onReject: (message: string) => void
  /** Reports every document-changing action (add sector/element/endpoint, dependency — REQ-09) with the document
   * as it stood just before, so App.tsx can toast it with Undo through the one mechanism it already uses for
   * Hexagonal — the same callback CleanEditor receives, so the "Depend on…" gesture toasts identically whether it
   * started from the canvas or the editor's own create form (ADR-02). */
  onMutate?: (message: string, before: CleanFile) => void
  /** Clears whatever toast is up without offering it as an undo step — fires only when a freshly created
   * element's naming is cancelled, mirroring OnionStage's own `onCancelMutate` (and App.tsx's `onNamingCancel`
   * for a grown hexagon). */
  onCancelMutate?: () => void
  /** Whether the CleanEditor/Legend islands are open — reserves their own screen space so a fit never tucks the
   * diagram under them (`RingedStage`/`viewport.ts`'s `islandInset`). */
  panelOpen?: boolean
  legendOpen?: boolean
}

const REJECT_MESSAGE = 'A dependency can only point to the same ring or a more inward one.'

/** Canvas analogue for Clean (ADR-02): the diagram, its sector/element/endpoint "+" affordances (REQ-03, REQ-04,
 * REQ-07), and the "Depend on…" gesture (REQ-06) — shared with Onion via `RingedCanvas.tsx` (ADR-01). A new
 * sector has no canvas node of its own to attach an inline rename to (sectors only ever appear as wedge
 * dividers, REQ-08) — renaming one happens in `CleanEditor`; only a new ELEMENT opens inline here, same as
 * Onion's own "+" does. */
export function CleanStage({ model, doc, mode, svgRef, onReject, onMutate = () => {}, onCancelMutate = () => {}, panelOpen = false, legendOpen = false }: CleanStageProps) {
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const legend = legendForClean(doc)
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

  const pick = (point: CleanInsertionPoint) => {
    const item = cleanInsertionItem(point.action)
    const before = doc
    if (item.kind === 'sector') {
      addSector(item.patch)
      const ringName = doc.rings.find((r) => r.role === item.patch.ringRole)!.name
      onMutate(`Added ${item.patch.name} to ${ringName}.`, before)
    } else if (item.kind === 'element') {
      const id = addElement(item.patch)
      const sectorName = doc.sectors.find((s) => s.id === item.patch.sectorId)!.name
      onMutate(`Added ${item.patch.name} to ${sectorName}.`, before)
      setEditing({ id, name: item.patch.name })
    } else {
      const id = addEndpoint(item.collection, item.patch)
      if (id) onMutate(`Added ${item.patch.name} for ${elementName(doc.elements, item.patch.targetId)}.`, before)
    }
  }

  return (
    <RingedStage
      bounds={model.bounds}
      ariaLabel={doc.title || 'Clean diagram'}
      svgRef={svgRef}
      linking={linking}
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
          <CleanDiagram model={model} selected={selected} interactive validTargets={linkTargetRefs} legend={legend} mode={mode} hoverRef={hover.ref} />
          {cleanInsertionPoints(model, doc)
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
