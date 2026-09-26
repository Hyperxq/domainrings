import { useState, type Ref } from 'react'
import type { OnionLayoutModel } from '../layout/onion'
import { onionInsertionItem, onionInsertionPoints, type OnionInsertionPoint } from '../layout/onionInsertion'
import { useOnionStore } from '../model/onionStore'
import type { OnionFile } from '../model/schema'
import { OnionDiagram } from '../render/OnionDiagram'
import { DependChip, InlineNameField, PlusGlyph, useDependGesture } from './RingedCanvas'

const { addElement, updateElement, removeElement, addDependency, addEndpoint } = useOnionStore.getState()

interface OnionStageProps {
  model: OnionLayoutModel
  doc: OnionFile
  svgRef: Ref<SVGSVGElement>
  /** Reports why a click while linking was refused, for the app's own toast/notice mechanism (REQ-04). */
  onReject: (message: string) => void
}

const REJECT_MESSAGE = 'A dependency can only point to the same ring or a more inward one.'

/** Canvas analogue for Onion (ADR-02): the diagram, its ring/endpoint "+" affordances (REQ-05, REQ-07), and the
 * "Depend on…" gesture (REQ-04) — shared with Clean via `RingedCanvas.tsx` (ADR-01): select an element, choose
 * another in the same or a more inward ring; a valid target is marked with `data-link-target` while linking
 * (same convention Hexagonal's own link mode uses), and choosing one that is not valid cancels the gesture and
 * reports why via `onReject`, leaving the document unchanged either way. */
export function OnionStage({ model, doc, svgRef, onReject }: OnionStageProps) {
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const { selected, linking, setLinking, selectedElement, validTargets, linkTargetRefs, clickTarget } = useDependGesture({
    elements: model.elements,
    rings: doc.rings,
    onCreate: addDependency,
    onReject,
    rejectMessage: REJECT_MESSAGE,
  })
  // The "+" that just created `editing`'s element hasn't been laid out yet on this render; its own next render
  // carries the real position, so the inline field re-reads it from the (now current) model every render.
  const editingElement = editing && model.elements.find((e) => e.ref === editing.id)

  const pick = (point: OnionInsertionPoint) => {
    const item = onionInsertionItem(point.action)
    if (item.kind === 'element') {
      const id = addElement(item.patch)
      setEditing({ id, name: item.patch.name })
    } else {
      addEndpoint(item.collection, item.patch)
    }
  }

  return (
    <main className="stage">
      <svg
        ref={svgRef}
        className="canvas"
        role="figure"
        aria-label={doc.title || 'Onion diagram'}
        data-link-mode={linking ? '' : undefined}
        viewBox={`${model.bounds.x} ${model.bounds.y} ${model.bounds.width} ${model.bounds.height}`}
        onClick={(e) => clickTarget((e.target as Element).closest('.node')?.getAttribute('data-ref') ?? null)}
      >
        <OnionDiagram model={model} selected={selected} interactive validTargets={linkTargetRefs} />
        {onionInsertionPoints(model, doc).map((point) => (
          <PlusGlyph key={point.key} point={point} onPick={() => pick(point)} />
        ))}
        {selectedElement && !linking && validTargets.length > 0 && (
          <DependChip x={selectedElement.x} y={selectedElement.y} name={selectedElement.name} onLink={() => setLinking(true)} />
        )}
      </svg>
      {editing && editingElement && (
        <InlineNameField
          defaultValue={editing.name}
          onCommit={(name) => {
            updateElement(editing.id, { name })
            setEditing(null)
          }}
          onCancel={() => {
            removeElement(editing.id)
            setEditing(null)
          }}
        />
      )}
    </main>
  )
}
