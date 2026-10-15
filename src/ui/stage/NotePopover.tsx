import { useLayoutEffect, useState, type RefObject } from 'react'
import { NOTE_POPOVER_ID } from '../../render/NoteMarker'
import { hexIdOf } from '../canvasTarget'

const GAP = 8
/** Half of `.note-popover`'s max-width, so a note beside the stage edge is pulled back inside it. */
const HALF_WIDTH = 158

interface At {
  x: number
  y: number
  above: boolean
}

/** An element's whole note at a fixed, readable size over the stage, below its box (above it in the lower half).
 * It is placed from the box's rendered rect, so any zoom, pan or rotation lands it right. Inert to the pointer. */
export function NotePopover({ mainRef, hexId, refId, text }: { mainRef: RefObject<HTMLElement | null>; hexId?: string; refId: string; text: string }) {
  const [at, setAt] = useState<At | null>(null)
  useLayoutEffect(() => {
    const main = mainRef.current
    // A port is drawn twice under one ref (declaration and wall box); the labelled outlines are not boxes either.
    const anchor = [...(main?.querySelectorAll('.node[data-ref]') ?? [])].find(
      (n) => n.getAttribute('data-ref') === refId && !n.matches('.node-aggregate') && (hexId === undefined || hexIdOf(n) === hexId),
    )
    if (!main || !anchor) return setAt(null)
    const [stage, box] = [main.getBoundingClientRect(), anchor.getBoundingClientRect()]
    const above = box.top - stage.top > stage.height / 2
    const x = Math.max(HALF_WIDTH, Math.min(box.left + box.width / 2 - stage.left, stage.width - HALF_WIDTH))
    const y = above ? box.top - stage.top - GAP : box.bottom - stage.top + GAP
    setAt((prev) => (prev?.x === x && prev.y === y && prev.above === above ? prev : { x, y, above }))
  })
  if (!at) return null
  return (
    <div id={NOTE_POPOVER_ID} role="tooltip" className="note-popover" data-above={at.above ? '' : undefined} style={{ left: at.x, top: at.y }}>
      {text}
    </div>
  )
}
