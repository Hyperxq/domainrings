import type { Box, Point } from '../layout/layout'

/** (x, y) is the diagram coordinate shown at the stage's top-left corner. */
export interface Viewport {
  x: number
  y: number
  scale: number
}

export const MIN_SCALE = 0.1
export const MAX_SCALE = 4

const clamp = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))

export const toDiagram = (v: Viewport, screen: Point): Point => ({
  x: v.x + screen.x / v.scale,
  y: v.y + screen.y / v.scale,
})

export function zoomAt(v: Viewport, factor: number, screen: Point): Viewport {
  const anchor = toDiagram(v, screen)
  const scale = clamp(v.scale * factor)
  return { x: anchor.x - screen.x / scale, y: anchor.y - screen.y / scale, scale }
}

export const panBy = (v: Viewport, dx: number, dy: number): Viewport => ({
  x: v.x - dx / v.scale,
  y: v.y - dy / v.scale,
  scale: v.scale,
})

export interface Inset {
  top: number
  right: number
  bottom: number
  left: number
}

const NO_INSET: Inset = { top: 0, right: 0, bottom: 0, left: 0 }

/** Fits the bounds into the stage area not covered by floating islands. */
export function fitTo(bounds: Box, width: number, height: number, inset: Inset = NO_INSET): Viewport {
  const freeW = Math.max(1, width - inset.left - inset.right)
  const freeH = Math.max(1, height - inset.top - inset.bottom)
  const scale = clamp(Math.min(freeW / bounds.width, freeH / bounds.height))
  return {
    x: bounds.x + bounds.width / 2 - (inset.left + freeW / 2) / scale,
    y: bounds.y + bounds.height / 2 - (inset.top + freeH / 2) / scale,
    scale,
  }
}

/** The open legend island's width (styles.css `.legend[data-open]`). */
export const LEGEND_ISLAND_WIDTH = 260

// Mirrors the island placement in styles.css so a fit never tucks the diagram under a panel. On phones the open
// legend floats over the canvas: reserving its column would leave no room for the diagram.
export function islandInset({ width, height }: { width: number; height: number }, panelOpen: boolean, legendOpen: boolean): Inset {
  if (width <= 720) return { top: 104, right: 8, bottom: panelOpen ? height * 0.45 + 16 : 64, left: 8 }
  return { top: 64, right: legendOpen ? LEGEND_ISLAND_WIDTH + 24 : 16, bottom: panelOpen ? 16 : 60, left: panelOpen ? 324 : 16 }
}
