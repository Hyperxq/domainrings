import { useState, type RefObject } from 'react'
import { hexagonBounds } from '../../layout/lattice'
import { type MapHexagonLayout, type MapLayout } from '../../layout/map'
import { contains, fitMap, fitTo, islandInset, visibleRect } from '../viewport'
import { useElementSize, useViewportInteractions } from '../viewportChrome'

/** The stage's size, fit and pan/zoom state for a map, including the reset that keeps a manual viewport only while
 * every added, removed or shifted hexagon is still on screen. Called from `Stage`'s own render: the reset below is
 * a render-phase update, so it must stay in the component that renders the viewport. */
export function useStageViewport({
  model,
  hex,
  mainRef,
  revision,
  legendOpen,
  panelOpen,
  onPanStart,
}: {
  model: MapLayout
  hex: MapHexagonLayout
  mainRef: RefObject<HTMLElement | null>
  revision: number
  legendOpen: boolean
  panelOpen: boolean
  onPanStart: () => void
}) {
  const size = useElementSize(mainRef)
  const inset = islandInset(size, panelOpen, legendOpen)
  const effectiveSize = { width: size.width || model.bounds.width, height: size.height || model.bounds.height }
  const wholeFit = fitTo(model.bounds, effectiveSize.width, effectiveSize.height, inset, 0)
  const singleFit = fitMap(model.bounds, hexagonBounds(hex), effectiveSize.width, effectiveSize.height, inset)
  // On 2+ hexagons 'auto' IS the whole-map fit — it never falls back to the current hexagon alone, even
  // when that fit would read as illegible clutter (MIN_FIT_SCALE only still applies on a single-hexagon map).
  const autoFit = model.hexagons.length >= 2 ? wholeFit : singleFit
  // A new diagram, or the legend opening or closing, refits (unfreezes a manual viewport back to 'auto') — unlike
  // grow/import/delete, these bump `revision`, so this key alone can never see the map-shape changes FIT-02 covers.
  const fitKey = `${revision}:${legendOpen}`
  const interactions = useViewportInteractions({
    mainRef,
    autoFit,
    wholeFitScale: wholeFit.scale,
    fitKey,
    settleKey: `${size.width}x${size.height}`,
    onPanStart,
  })
  const { view, viewport, setView } = interactions
  const centre = { x: size.width / 2, y: size.height / 2 }

  // The panel only changes the free area, so an 'auto' view that still shows the current hexagon is frozen as it is
  // instead of refitting around the panel — otherwise revealing a just-named element snaps the canvas, and closing
  // the panel snaps it back. When the panel would cover it, 'auto' stays and eases to the new fit. On 2+ hexagons
  // 'auto' IS the whole-map fit and must keep tracking the free area (FIT-02.1), so it is never frozen there.
  const [seenPanelOpen, setSeenPanelOpen] = useState(panelOpen)
  if (panelOpen !== seenPanelOpen) {
    setSeenPanelOpen(panelOpen)
    if (view === 'auto' && model.hexagons.length < 2 && contains(visibleRect(viewport, effectiveSize, inset), hexagonBounds(hex))) setView(viewport)
  }

  // Grow/import/delete/undo never bump `revision` (ADR-02/ADR-05), so the fitKey reset above can't see them — this
  // tracks the hexagon id set instead. A `Viewport` the author set stays iff every added/removed/shifted box is still fully
  // on screen (FIT-02.2); otherwise it falls back to 'auto', which recomputes against the new bounds every render
  // and — on 2+ hexagons — always follows the whole map, never frozen (FIT-02.1). On a compact map the full hexagons
  // are part of the key too: which ones are full sizes the lattice, so switching one moves every hexagon.
  const hexKey = model.hexagons.map((h) => h.id).join(',') + (model.hexagons.some((h) => h.compact) ? `@${model.hexagons.filter((h) => !h.compact).map((h) => h.id).join(',')}` : '')
  const [seenHexagons, setSeenHexagons] = useState({ key: hexKey, hexagons: model.hexagons })
  if (hexKey !== seenHexagons.key) {
    const nextIds = new Set(model.hexagons.map((h) => h.id))
    const prevIds = new Set(seenHexagons.hexagons.map((h) => h.id))
    const prev = new Map(seenHexagons.hexagons.map((h) => [h.id, h]))
    // A pitch change (the largest hexagon came or went) also shifts every surviving hexagon's lattice slot, and a
    // hexagon that expands or compacts in place changes size without moving.
    const moved = model.hexagons.filter((h) => {
      const before = prev.get(h.id)
      return before && (before.centre.x !== h.centre.x || before.centre.y !== h.centre.y || !before.compact !== !h.compact)
    })
    const changed = [...model.hexagons.filter((h) => !prevIds.has(h.id)), ...seenHexagons.hexagons.filter((h) => !nextIds.has(h.id)), ...moved]
    setSeenHexagons({ key: hexKey, hexagons: model.hexagons })
    if (typeof view !== 'string' && !changed.every((h) => contains(visibleRect(view, effectiveSize, inset), hexagonBounds(h)))) setView('auto')
  }
  return { ...interactions, size, centre }
}
