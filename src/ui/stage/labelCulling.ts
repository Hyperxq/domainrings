import type { Box } from '../../layout/geometry'

export interface LabelCandidate {
  key: string
  /** The element the label names; its own boxes are not obstacles. */
  owner?: string
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

/** Each box reduced to a zone of `clearance` around its centre: at far zoom a label is wider than the boxes around it,
 * so it may run over their edges as long as every box keeps its middle in view to be seen and hovered. */
export const centreZones = (obstacles: readonly Obstacle[], clearance: number): Obstacle[] =>
  obstacles.map(({ owner, rect }) => {
    const [w, h] = [Math.min(rect.width, 2 * clearance), Math.min(rect.height, 2 * clearance)]
    return { owner, rect: { x: rect.x + (rect.width - w) / 2, y: rect.y + (rect.height - h) / 2, width: w, height: h } }
  })

export interface Obstacle {
  /** The element this box belongs to; a label may cover its own element's boxes. */
  owner: string
  /** Screen-space rectangle of the box. */
  rect: Box
}

const touches = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/** A spatial hash of rectangles: a query only visits the cells the probe covers. */
function grid<T extends { rect: Box }>(items: readonly T[] = []) {
  const cells = new Map<string, T[]>()
  const keysOf = ({ x, y, width, height }: Box) => {
    const out: string[] = []
    for (let i = Math.floor(x / CELL); i <= Math.floor((x + width) / CELL); i++)
      for (let j = Math.floor(y / CELL); j <= Math.floor((y + height) / CELL); j++) out.push(`${i},${j}`)
    return out
  }
  const add = (item: T) => {
    for (const c of keysOf(item.rect)) cells.get(c)?.push(item) ?? cells.set(c, [item])
  }
  items.forEach(add)
  return { add, hits: (probe: Box, skip?: (item: T) => boolean) => keysOf(probe).some((c) => cells.get(c)?.some((p) => !skip?.(p) && touches(probe, p.rect))) }
}

/** The keys of the labels to show: placed greedily by priority, each dropped when it would touch an already placed one
 * or another element's box (within `padding`); forced labels ignore the boxes. Grids of the rectangles keep each check
 * local, so a pass is O(n log n). */
export function cullLabels(candidates: readonly LabelCandidate[], padding: number, obstacles: readonly Obstacle[] = []): Set<string> {
  const order = [...candidates].sort(
    (a, b) => Number(!!b.forced) - Number(!!a.forced) || a.tier - b.tier || b.area - a.area || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  )
  const boxes = grid(obstacles)
  const placed = grid<{ rect: Box }>()
  const shown = new Set<string>()
  for (const { key, owner, rect, forced } of order) {
    const grown = { x: rect.x - padding, y: rect.y - padding, width: rect.width + 2 * padding, height: rect.height + 2 * padding }
    if (!forced && (placed.hits(grown) || boxes.hits(grown, (b) => owner !== undefined && b.owner === owner))) continue
    shown.add(key)
    placed.add({ rect })
  }
  return shown
}
