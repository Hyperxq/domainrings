import type { Diagram, Hexagon, HexaMap } from './schema'

/** The v1-shaped view of one hexagon, for every consumer still typed on `Diagram` (layout, insertion, links, legend). */
export function diagramOf(map: HexaMap, hexId: string): Diagram {
  const hexagon = map.hexagons.find((h) => h.id === hexId)
  if (!hexagon) throw new Error(`Unknown hexagon id "${hexId}"`)
  const { id: _id, contextId: _contextId, cell: _cell, ...fields } = hexagon
  return { version: 1, kind: map.kind, ...fields }
}

/** Writes a `Diagram` edit back onto its hexagon, dropping the fields that live on the map instead. */
export function putDiagram(map: HexaMap, hexId: string, diagram: Diagram): HexaMap {
  const { version: _version, kind: _kind, ...fields } = diagram
  return {
    ...map,
    hexagons: map.hexagons.map((h): Hexagon => (h.id === hexId ? { id: h.id, contextId: h.contextId, cell: h.cell, ...fields } : h)),
  }
}
