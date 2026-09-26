import { useState, type Ref } from 'react'
import type { CleanLayoutModel } from '../layout/clean'
import { cleanInsertionItem, cleanInsertionPoints, type CleanInsertionPoint } from '../layout/cleanInsertion'
import { useCleanStore } from '../model/cleanStore'
import type { CleanFile } from '../model/schema'
import { CleanDiagram } from '../render/CleanDiagram'
import { PlusGlyph, useDependGesture } from './RingedCanvas'

const { addSector, addElement, updateElement, removeElement, addDependency, addEndpoint } = useCleanStore.getState()

interface CleanStageProps {
  model: CleanLayoutModel
  doc: CleanFile
  svgRef: Ref<SVGSVGElement>
  /** Reports why a click while linking was refused, for the app's own toast/notice mechanism (REQ-06). */
  onReject: (message: string) => void
}

const REJECT_MESSAGE = 'A dependency can only point to the same ring or a more inward one.'

/** Canvas analogue for Clean (ADR-02): the diagram, its sector/element/endpoint "+" affordances (REQ-03, REQ-04,
 * REQ-07), and the "Depend on…" gesture (REQ-06) — shared with Onion via `RingedCanvas.tsx` (ADR-01). A new
 * sector has no canvas node of its own to attach an inline rename to (sectors only ever appear as wedge
 * dividers, REQ-08) — renaming one happens in `CleanEditor`; only a new ELEMENT opens inline here, same as
 * Onion's own "+" does. */
export function CleanStage({ model, doc, svgRef, onReject }: CleanStageProps) {
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

  const pick = (point: CleanInsertionPoint) => {
    const item = cleanInsertionItem(point.action)
    if (item.kind === 'sector') {
      addSector(item.patch)
    } else if (item.kind === 'element') {
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
        aria-label={doc.title || 'Clean diagram'}
        data-link-mode={linking ? '' : undefined}
        viewBox={`${model.bounds.x} ${model.bounds.y} ${model.bounds.width} ${model.bounds.height}`}
        onClick={(e) => clickTarget((e.target as Element).closest('.node')?.getAttribute('data-ref') ?? null)}
      >
        <CleanDiagram model={model} selected={selected} interactive validTargets={linkTargetRefs} />
        {cleanInsertionPoints(model, doc).map((point) => (
          <PlusGlyph key={point.key} point={point} onPick={() => pick(point)} />
        ))}
        {selectedElement && !linking && validTargets.length > 0 && (
          <g
            className="ringed-depend-chip"
            data-plus=""
            transform={`translate(${selectedElement.x} ${selectedElement.y - 26})`}
            tabIndex={0}
            role="button"
            aria-label={`Depend on… from ${selectedElement.name}`}
            onClick={(e) => {
              e.stopPropagation()
              setLinking(true)
            }}
          >
            <rect x={-38} y={-11} width={76} height={22} rx={11} />
            <text x={0} y={0} dominantBaseline="middle" textAnchor="middle">Depend on…</text>
          </g>
        )}
      </svg>
      {editing && editingElement && (
        <input
          className="inline-name ringed-inline-name"
          aria-label="element name"
          autoFocus
          defaultValue={editing.name}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              e.stopPropagation()
              removeElement(editing.id)
              setEditing(null)
            }
          }}
          onBlur={(e) => {
            const name = e.currentTarget.value.trim()
            if (name) updateElement(editing.id, { name })
            else removeElement(editing.id)
            setEditing(null)
          }}
        />
      )}
    </main>
  )
}
