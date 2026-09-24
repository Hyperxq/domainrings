import { linkEndProblem, type Diagram, type HexaMap, type Hexagon, type Link, type LinkEnd } from './schema'

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

/**
 * Removes links whose end in `hexId` no longer stands after an edit there — its port was deleted or moved to the
 * other side (LINK-01.1/.2) — leaving every other link untouched. An end whose only problem is its own adapter
 * (deleted or re-pointed elsewhere) keeps the link, with that adapter cleared (LINK-01.3): `linkEndProblem` is
 * reused to tell the two apart, by checking whether dropping the adapter alone would already clear the problem.
 */
export function pruneLinks(map: HexaMap, hexId: string): { map: HexaMap; pruned: Link[] } {
  const pruned: Link[] = []
  let changed = false
  const links = map.links.reduce<Link[]>((kept, link) => {
    let next = link
    for (const role of ['from', 'to'] as const) {
      const end = next[role]
      if (end.hexagonId !== hexId || !linkEndProblem(map, end, role)) continue
      const withoutAdapter: LinkEnd = { ...end, adapterId: undefined }
      if (!linkEndProblem(map, withoutAdapter, role)) {
        next = { ...next, [role]: withoutAdapter }
      } else {
        pruned.push(link)
        changed = true
        return kept
      }
    }
    if (next !== link) changed = true
    kept.push(next)
    return kept
  }, [])
  return { map: changed ? { ...map, links } : map, pruned }
}
