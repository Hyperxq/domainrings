import type { Box, Point } from '../layout/layout'

/** (x, y) is the diagram coordinate shown at the stage's top-left corner. */
export interface Viewport {
  x: number
  y: number
  scale: number
}

export const MIN_SCALE = 0.1
export const MAX_SCALE = 4

const clamp = (s: number, minScale: number = MIN_SCALE) => Math.min(MAX_SCALE, Math.max(minScale, s))

export const toDiagram = (v: Viewport, screen: Point): Point => ({
  x: v.x + screen.x / v.scale,
  y: v.y + screen.y / v.scale,
})

export function zoomAt(v: Viewport, factor: number, screen: Point, minScale: number = MIN_SCALE): Viewport {
  const anchor = toDiagram(v, screen)
  const scale = clamp(v.scale * factor, minScale)
  return { x: anchor.x - screen.x / scale, y: anchor.y - screen.y / scale, scale }
}

export const panBy = (v: Viewport, dx: number, dy: number): Viewport => ({
  x: v.x - dx / v.scale,
  y: v.y - dy / v.scale,
  scale: v.scale,
})

const midpoint = ([a, b]: [Point, Point]): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const distance = ([a, b]: [Point, Point]) => Math.hypot(b.x - a.x, b.y - a.y)

/** Two-finger pinch: the finger-distance ratio zooms around the gesture's starting midpoint (keeping the diagram
 * point under it fixed, like `zoomAt`), then the midpoint's own movement pans the result. */
export function pinch(v: Viewport, from: [Point, Point], to: [Point, Point], minScale: number = MIN_SCALE): Viewport {
  const fromDistance = distance(from)
  const factor = fromDistance > 0 ? distance(to) / fromDistance : 1
  const fromMid = midpoint(from)
  const toMid = midpoint(to)
  const zoomed = zoomAt(v, factor, fromMid, minScale)
  return panBy(zoomed, toMid.x - fromMid.x, toMid.y - fromMid.y)
}

export interface Inset {
  top: number
  right: number
  bottom: number
  left: number
}

const NO_INSET: Inset = { top: 0, right: 0, bottom: 0, left: 0 }

/** Fits the bounds into the stage area not covered by floating islands. `minScale` overrides the usual MIN_SCALE
 * floor — an explicit "Fit all" passes 0 so a huge map is never clamped to a partial view (FIT-01.1). */
export function fitTo(bounds: Box, width: number, height: number, inset: Inset = NO_INSET, minScale: number = MIN_SCALE): Viewport {
  const freeW = Math.max(1, width - inset.left - inset.right)
  const freeH = Math.max(1, height - inset.top - inset.bottom)
  const scale = clamp(Math.min(freeW / bounds.width, freeH / bounds.height), minScale)
  return {
    x: bounds.x + bounds.width / 2 - (inset.left + freeW / 2) / scale,
    y: bounds.y + bounds.height / 2 - (inset.top + freeH / 2) / scale,
    scale,
  }
}

/** The diagram-space box visible through the stage area, floating panels excluded — the inverse of `fitTo`'s framing. */
export function visibleRect(v: Viewport, size: { width: number; height: number }, inset: Inset = NO_INSET): Box {
  const topLeft = toDiagram(v, { x: inset.left, y: inset.top })
  const bottomRight = toDiagram(v, { x: size.width - inset.right, y: size.height - inset.bottom })
  return { x: topLeft.x, y: topLeft.y, width: bottomRight.x - topLeft.x, height: bottomRight.y - topLeft.y }
}

/** True when `inner` lies fully inside `outer`, touching its edges allowed. */
export const contains = (outer: Box, inner: Box): boolean =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height

/** Below this scale the whole map reads as illegible clutter; fitting the current hexagon instead keeps it usable (CANVAS-04). */
export const MIN_FIT_SCALE = 0.4

/** Fits the whole map; falls back to fitting the current hexagon when that would shrink it past MIN_FIT_SCALE. */
export function fitMap(mapBounds: Box, currentBounds: Box, width: number, height: number, inset: Inset = NO_INSET): Viewport {
  const whole = fitTo(mapBounds, width, height, inset)
  return whole.scale >= MIN_FIT_SCALE ? whole : fitTo(currentBounds, width, height, inset)
}

/** The open legend island's width (styles.css `.legend[data-open]`). */
export const LEGEND_ISLAND_WIDTH = 260
/** Bottom edge of the collapsed editor chip: 72px from the top, a 32px button in 6px padding and a 1px border. */
export const EDITOR_CHIP_BOTTOM = 72 + 46

// Mirrors the island placement in styles.css so a fit never tucks the diagram under a panel. On phones the open
// legend floats over the canvas: reserving its column would leave no room for the diagram.
export function islandInset({ width, height }: { width: number; height: number }, panelOpen: boolean, legendOpen: boolean): Inset {
  // Below the toolbar's wrap point (styles.css `@media (max-width: 640px)`) it grows from one row to two,
  // pushing the zoom island — and everything reserved below it — down by that extra row's height.
  if (width <= 640) return { top: 140, right: 8, bottom: panelOpen ? height * 0.45 + 16 : 64, left: 8 }
  if (width <= 720) return { top: 104, right: 8, bottom: panelOpen ? height * 0.45 + 16 : 64, left: 8 }
  // Open, the editor takes the left column; collapsed, its chip still sits top-left, where the diagram's title goes.
  return { top: panelOpen ? 64 : EDITOR_CHIP_BOTTOM + 8, right: legendOpen ? LEGEND_ISLAND_WIDTH + 24 : 16, bottom: panelOpen ? 16 : 60, left: panelOpen ? 324 : 16 }
}
