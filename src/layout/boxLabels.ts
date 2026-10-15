import type { HexaMap } from '../model/schema'
import type { Box } from './geometry'
import type { LayoutNode } from './layout'
import type { MapLayout } from './map'

export interface BoxLabel {
  /** Unique across the map (a ref can repeat between hexagons). */
  key: string
  hexagonId: string
  ref: string
  /** The element the label names: its boxes (a port's socket and its text) are not obstacles to it. */
  owner: string
  kind: LayoutNode['kind']
  text: string
  /** Placement priority: 0 use cases, ports and aggregate roots, 1 adapters, actors and externals, 2 the domain and composition. */
  tier: 0 | 1 | 2
  /** The box's centre on the map. */
  x: number
  y: number
  /** The box's size, in map units squared. */
  area: number
}

const TIER: Partial<Record<LayoutNode['kind'], BoxLabel['tier']>> = {
  useCase: 0,
  port: 0,
  adapter: 1,
  actor: 1,
  external: 1,
  domainItem: 2,
  composition: 2,
}

/** Each element's own name by ref: a box may wrap it over several lines, and a label shows it whole. */
function namesOf(h: HexaMap['hexagons'][number]): ReadonlyMap<string, string> {
  const items = [...h.domain, ...h.useCases, ...h.ports, ...h.adapters, ...h.actors, ...h.externals]
  return new Map([...items.map((i): [string, string] => [i.id, i.name]), ...(h.composition ? [['composition', h.composition.name] as [string, string]] : [])])
}

const isAggregateRoot = (h: HexaMap['hexagons'][number], ref: string) => h.domain.some((i) => i.id === ref && i.type === 'aggregate' && !i.parentId)

const ownerOf = (hexagonId: string, ref: string) => `${hexagonId}:${ref}`

/** One label per named box of every full hexagon; compact hexagons carry their own title. */
export function boxLabels(model: MapLayout, map: HexaMap): BoxLabel[] {
  return model.hexagons.flatMap((h) => {
    const source = h.compact ? undefined : map.hexagons.find((m) => m.id === h.id)
    if (!source) return []
    const names = namesOf(source)
    return h.model.nodes.flatMap((node) => {
      const tier = node.kind === 'domainItem' && isAggregateRoot(source, node.ref) ? 0 : TIER[node.kind]
      const text = names.get(node.ref)?.trim()
      if (tier === undefined || !text) return []
      return [{ key: `${h.id}:${node.key}`, hexagonId: h.id, ref: node.ref, owner: ownerOf(h.id, node.ref), kind: node.kind, text, tier, x: node.x + h.centre.x, y: node.y + h.centre.y, area: node.width * node.height }]
    })
  })
}

export interface BoxObstacle {
  owner: string
  /** The box's axis-aligned bounds on the map. */
  rect: Box
}

/** Every box of every full hexagon, for labels to keep clear of. An aggregate's outline is left out: it holds the boxes
 * it groups, so a label inside it would always touch it. */
export function boxObstacles(model: MapLayout, map: HexaMap): BoxObstacle[] {
  return model.hexagons.flatMap((h) => {
    if (h.compact || !map.hexagons.some((m) => m.id === h.id)) return []
    return h.model.nodes
      .filter((n) => n.kind !== 'aggregate')
      .map((n) => ({ owner: ownerOf(h.id, n.ref), rect: { x: n.x + h.centre.x - n.width / 2, y: n.y + h.centre.y - n.height / 2, width: n.width, height: n.height } }))
  })
}
