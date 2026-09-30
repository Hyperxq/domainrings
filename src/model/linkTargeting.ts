import { linkTargets } from './links'
import { crossHexagonPorts, type PortRef } from './map'
import type { Diagram, HexaMap } from './schema'

// ADR-02: a port's cross-hexagon targets — every port of the opposite side on another hexagon. Non-ports (and
// an unselected ref) have none; only ports carry map-level links.
export function crossPortTargets(map: HexaMap, diagram: Diagram, hexId: string, ref: string | null): PortRef[] {
  const port = ref ? diagram.ports.find((p) => p.id === ref) : undefined
  return port ? crossHexagonPorts(map, port.side === 'driven' ? 'driving' : 'driven', hexId) : []
}

/** Whether `ref` has anything to link to: a same-hexagon field target or a cross-hexagon port. */
export function canLink(map: HexaMap, diagram: Diagram, hexId: string, ref: string): boolean {
  return linkTargets(diagram, ref).length > 0 || crossPortTargets(map, diagram, hexId, ref).length > 0
}

// Decision 7387: the targets grouped by hexagon id, for MapDiagram to mark on the hexagons that own them —
// a bare portId is not enough, since ids collide across hexagons by construction (see the decoy-port test).
export function targetsByHexagon(targets: PortRef[]): Map<string, Set<string>> {
  const byHexagon = new Map<string, Set<string>>()
  for (const t of targets) {
    const set = byHexagon.get(t.hexagonId)
    if (set) set.add(t.portId)
    else byHexagon.set(t.hexagonId, new Set([t.portId]))
  }
  return byHexagon
}

/** Whether `ref`, clicked or activated inside another hexagon's group, is one of the valid cross-hexagon targets. */
export function isCrossTarget(targets: PortRef[], currentHexId: string, clickedHexId: string | null | undefined, ref: string | null): boolean {
  return !!ref && !!clickedHexId && clickedHexId !== currentHexId && targets.some((p) => p.hexagonId === clickedHexId && p.portId === ref)
}
