import { useEffect, type Dispatch, type SetStateAction } from 'react'
import { canLink } from '../../model/linkTargeting'
import type { Diagram, HexaMap } from '../../model/schema'
import { keyOnCanvas } from '../keys'

/** The canvas's document-level keyboard and pointer handling: Escape leaves link mode, then clears the selection;
 * Delete removes it; `L` starts linking it (both inert in view-only mode); a press outside the canvas ends link mode. */
export function useCanvasShortcuts({
  selected,
  linking,
  hexId,
  map,
  diagram,
  viewOnly,
  onDelete,
  onLinking,
  setSelected,
  setHovered,
}: {
  selected: string | null
  linking: string | null
  hexId: string
  map: HexaMap
  diagram: Diagram
  viewOnly: boolean
  onDelete: (ref: string) => boolean
  onLinking: (ref: string | null) => void
  setSelected: Dispatch<SetStateAction<string | null>>
  setHovered: Dispatch<SetStateAction<string | null>>
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Esc first leaves link mode, keeping the selection; a second Esc clears it.
      if (e.key === 'Escape' && linking) onLinking(null)
      else if (e.key === 'Escape') {
        setHovered(null)
        setSelected(null)
      }
      if (!selected || linking || viewOnly || !keyOnCanvas(e.target)) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        if (onDelete(selected)) setSelected(null)
      }
      if (e.key.toLowerCase() === 'l' && !e.metaKey && !e.ctrlKey && !e.altKey && canLink(map, diagram, hexId, selected)) {
        e.preventDefault()
        onLinking(selected)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, onDelete, linking, onLinking, diagram, map, viewOnly])

  useEffect(() => {
    if (!linking) return
    // Link mode ends on any press outside the canvas (the hint's own close button ends it too).
    const away = (e: PointerEvent) => !(e.target as Element).closest?.('svg.canvas, .toast') && onLinking(null)
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [linking, onLinking])
}
