import { useEffect, useState, type Ref } from 'react'
import type { OnionLayoutModel } from '../layout/onion'
import { onionInsertionItem, onionInsertionPoints, type OnionInsertionPoint } from '../layout/onionInsertion'
import { useOnionStore } from '../model/onionStore'
import { isInwardOrSame } from '../model/rings'
import type { OnionFile } from '../model/schema'
import { OnionDiagram } from '../render/OnionDiagram'

const { addElement, updateElement, removeElement, addDependency, addEndpoint } = useOnionStore.getState()

interface OnionStageProps {
  model: OnionLayoutModel
  doc: OnionFile
  svgRef: Ref<SVGSVGElement>
  /** Reports why a click while linking was refused, for the app's own toast/notice mechanism (REQ-04). */
  onReject: (message: string) => void
}

const NO_TARGETS = new Set<string>()
const REJECT_MESSAGE = 'A dependency can only point to the same ring or a more inward one.'

/** A ring or endpoint "+", drawn as a plain SVG glyph — Onion has no pan/zoom yet (nothing in REQ-04/05/07 needs
 * it), so there is no screen/diagram coordinate split to bridge; every affordance lives in the same SVG. */
function PlusGlyph({ point, onPick }: { point: OnionInsertionPoint; onPick: () => void }) {
  return (
    <g
      className="onion-plus"
      data-plus=""
      transform={`translate(${point.at.x} ${point.at.y})`}
      tabIndex={0}
      role="button"
      aria-label={point.label}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        onPick()
      }}
    >
      <circle r={10} />
      <line x1={-5} y1={0} x2={5} y2={0} />
      <line x1={0} y1={-5} x2={0} y2={5} />
    </g>
  )
}

/** Canvas analogue for Onion (ADR-02): the diagram, its ring/endpoint "+" affordances (REQ-05, REQ-07), and the
 * "Depend on…" gesture (REQ-04) — select an element, choose another in the same or a more inward ring; a valid
 * target is marked with `data-link-target` while linking (same convention Hexagonal's own link mode uses), and
 * choosing one that is not valid cancels the gesture and reports why via `onReject`, leaving the document
 * unchanged either way. */
export function OnionStage({ model, doc, svgRef, onReject }: OnionStageProps) {
  const [selected, setSelected] = useState<string | null>(null)
  const [linking, setLinking] = useState(false)
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (linking) setLinking(false)
      else setSelected(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [linking])

  const selectedElement = selected ? model.elements.find((e) => e.ref === selected) : undefined
  const validTargets = selectedElement ? model.elements.filter((e) => e.ref !== selected && isInwardOrSame(doc.rings, selectedElement.ringRole, e.ringRole)) : []
  const linkTargetRefs = linking ? new Set(validTargets.map((e) => e.ref)) : NO_TARGETS
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

  const clickTarget = (ref: string | null) => {
    if (!ref) {
      setLinking(false)
      setSelected(null)
      return
    }
    if (linking && selected) {
      if (validTargets.some((e) => e.ref === ref)) addDependency(selected, ref)
      else onReject(REJECT_MESSAGE)
      setLinking(false)
      setSelected(null)
      return
    }
    setSelected(ref)
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
          <g
            className="onion-depend-chip"
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
          className="inline-name onion-inline-name"
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
