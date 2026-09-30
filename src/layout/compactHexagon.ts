import { UNTITLED_HEXAGON } from '../model/map'
import type { Hexagon, Wall } from '../model/schema'
import type { Box, Point } from './geometry'
import { wallFrame } from './hexagon/walls'
import type { LayoutModel } from './layout'
import type { MapHexagonLayout } from './map'
import { measure } from './text'

/** A port's marker on a compact hexagon's silhouette; `at` is relative to the hexagon's centre. */
export interface CompactPort {
  id: string
  name: string
  wall: Wall
  at: Point
}

/** A non-current hexagon drawn as its silhouette alone: a regular pointy-top hexagon of `radius` about its centre. */
export interface CompactLayout {
  radius: number
  /** The title's font size; the element count is drawn a little smaller. Grows with `radius` so the title stays
   * readable when the whole map is fitted. */
  size: number
  /** Every domain item, use case, port, adapter, actor and external the hexagon holds. */
  elements: number
  /** The hexagon's title, shortened with an ellipsis to fit inside the silhouette. */
  label: string
  ports: CompactPort[]
}

/** From this many hexagons up, every hexagon but the current and the expanded ones renders compact. */
export const COMPACT_FROM = 4
/** Whether a map of `count` hexagons is large enough to compact; `layoutMap` still draws every hexagon full without a current or expanded set. */
export const canCompact = (count: number): boolean => count >= COMPACT_FROM
/** A compact hexagon's silhouette radius and title size at unit scale; both grow together so a title always fits. */
export const COMPACT_RADIUS = 78
export const COMPACT_TITLE = { size: 14, em: 0.6 } as const
/** Room kept clear of the silhouette's edge on each side of a compact title. */
const COMPACT_TITLE_PAD = 14
/** The most of a full hexagon's height a compact silhouette may take, so a large map's compact hexagons never
 * outgrow the ones being read. */
export const COMPACT_MAX_SHARE = 1 / 3
const ELLIPSIS = '…'

export const compactBounds = (radius: number): Box => ({ x: (-radius * Math.sqrt(3)) / 2, y: -radius, width: radius * Math.sqrt(3), height: radius * 2 })

/** A hexagon's own (untranslated) bounds — its silhouette when compact — shifted onto the map by its `centre` (ADR-04). */
export const hexagonBounds = (hex: Pick<MapHexagonLayout, 'model' | 'centre' | 'compact'>): Box => {
  const own = hex.compact ? compactBounds(hex.compact.radius) : hex.model.bounds
  return { x: own.x + hex.centre.x, y: own.y + hex.centre.y, width: own.width, height: own.height }
}

/** `title` cut to fit the widest part of a compact silhouette, ending in an ellipsis when it had to be shortened. */
function compactLabel(title: string): string {
  const room = COMPACT_RADIUS * Math.sqrt(3) - 2 * COMPACT_TITLE_PAD
  if (measure(title, COMPACT_TITLE) <= room) return title
  let label = title
  while (label.length > 1 && measure(label + ELLIPSIS, COMPACT_TITLE) > room) label = label.slice(0, -1).trimEnd()
  return label + ELLIPSIS
}

/** Each port's marker on the wall it sits on, spread along that wall so ports sharing one never share a point. */
function compactPorts(hexagon: Hexagon, model: LayoutModel, radius: number): CompactPort[] {
  const walled = hexagon.ports.flatMap((port) => {
    const wall = model.nodes.find((n) => n.kind === 'port' && n.ref === port.id)?.wall
    return wall ? [{ id: port.id, name: port.name, wall }] : []
  })
  const apothem = (radius * Math.sqrt(3)) / 2
  return walled.map((port) => {
    const onWall = walled.filter((p) => p.wall === port.wall)
    const { n, dir } = wallFrame(port.wall)
    const spacing = Math.min(radius * 0.3, (radius * 0.9) / onWall.length)
    const along = (onWall.indexOf(port) - (onWall.length - 1) / 2) * spacing
    return { ...port, at: { x: n.x * apothem + dir.x * along, y: n.y * apothem + dir.y * along } }
  })
}

export const compactOf = (hexagon: Hexagon, model: LayoutModel, unit: number): CompactLayout => ({
  radius: COMPACT_RADIUS * unit,
  size: COMPACT_TITLE.size * unit,
  elements: hexagon.domain.length + hexagon.useCases.length + hexagon.ports.length + hexagon.adapters.length + hexagon.actors.length + hexagon.externals.length,
  label: compactLabel(hexagon.title || UNTITLED_HEXAGON),
  ports: compactPorts(hexagon, model, COMPACT_RADIUS * unit),
})
