/** Id of the note popover, so the selected node can point at it with aria-describedby. */
export const NOTE_POPOVER_ID = 'note-popover'

/** How far a box's marker sits in from its top-right corner. */
export const NOTE_INSET = 5

/** A dot marking an element that has a note. Canvas-only — exports strip it. */
export function NoteMarker({ x, y }: { x: number; y: number }) {
  return <circle className="note-marker" data-note-marker="" aria-hidden="true" cx={x} cy={y} r={2.5} />
}
