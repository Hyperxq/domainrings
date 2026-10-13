import type { Box } from '../../layout/geometry'

export interface LabelCandidate {
  key: string
  /** Screen-space rectangle the label would cover. */
  rect: Box
  /** 0 is placed first. */
  tier: 0 | 1 | 2
  /** The box's size, larger first within a tier. */
  area: number
  /** Placed before every other label and always shown. */
  forced?: boolean
}

const CELL = 64

/** The keys of the labels to show: placed greedily by priority, each dropped when it would touch an already placed one
 * (within `padding`). A grid of the placed rectangles keeps each check local, so a pass is O(n log n). */
export function cullLabels(candidates: readonly LabelCandidate[], padding: number): Set<string> {
  const order = [...candidates].sort(
    (a, b) => Number(!!b.forced) - Number(!!a.forced) || a.tier - b.tier || b.area - a.area || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  )
  const grid = new Map<string, Box[]>()
  const cells = ({ x, y, width, height }: Box) => {
    const out: string[] = []
    for (let i = Math.floor(x / CELL); i <= Math.floor((x + width) / CELL); i++)
      for (let j = Math.floor(y / CELL); j <= Math.floor((y + height) / CELL); j++) out.push(`${i},${j}`)
    return out
  }
  const shown = new Set<string>()
  for (const { key, rect, forced } of order) {
    const grown = { x: rect.x - padding, y: rect.y - padding, width: rect.width + 2 * padding, height: rect.height + 2 * padding }
    const near = cells(grown)
    const clear = !near.some((c) =>
      grid.get(c)?.some((p) => grown.x < p.x + p.width && p.x < grown.x + grown.width && grown.y < p.y + p.height && p.y < grown.y + grown.height),
    )
    if (!clear && !forced) continue
    shown.add(key)
    for (const c of cells(rect)) grid.get(c)?.push(rect) ?? grid.set(c, [rect])
  }
  return shown
}
