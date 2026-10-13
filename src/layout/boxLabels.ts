import type { HexaMap } from '../model/schema'
import type { LayoutNode } from './layout'
import type { MapLayout } from './map'

export interface BoxLabel {
  /** Unique across the map (a ref can repeat between hexagons). */
  key: string
  hexagonId: string
  ref: string
  kind: LayoutNode['kind']
  text: string
  /** Placement priority: 0 use cases and ports, 1 adapters, actors and externals, 2 the domain and composition. */
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
  portLabel: 0,
  adapter: 1,
  actor: 1,
  external: 1,
  domainItem: 2,
  portDecl: 2,
  composition: 2,
}

/** Each element's own name by ref: a box may wrap it over several lines, and a label shows it whole. */
function namesOf(h: HexaMap['hexagons'][number]): ReadonlyMap<string, string> {
  const items = [...h.domain, ...h.useCases, ...h.ports, ...h.adapters, ...h.actors, ...h.externals]
  return new Map([...items.map((i): [string, string] => [i.id, i.name]), ...(h.composition ? [['composition', h.composition.name] as [string, string]] : [])])
}

/** One label per named box of every full hexagon; compact hexagons carry their own title. */
export function boxLabels(model: MapLayout, map: HexaMap): BoxLabel[] {
  return model.hexagons.flatMap((h) => {
    const source = h.compact ? undefined : map.hexagons.find((m) => m.id === h.id)
    if (!source) return []
    const names = namesOf(source)
    return h.model.nodes.flatMap((node) => {
      const tier = TIER[node.kind]
      const text = names.get(node.ref)?.trim()
      if (tier === undefined || !text) return []
      return [{ key: `${h.id}:${node.key}`, hexagonId: h.id, ref: node.ref, kind: node.kind, text, tier, x: node.x + h.centre.x, y: node.y + h.centre.y, area: node.width * node.height }]
    })
  })
}
