import type { Chain } from './chain'
import { diagramOf } from './map'
import { useCasesOf, type Diagram, type HexaMap, type Port } from './schema'

export type FlowRole = 'actor' | 'adapter' | 'drivingPort' | 'useCase' | 'aggregate' | 'drivenPort' | 'drivenAdapter' | 'external' | 'linkedPort'

export interface FlowStep {
  role: FlowRole
  hexId: string
  id: string
  name: string
  /** The author's explanation of this step, from `useCase.stepNotes`. */
  note?: string
  /** On a driven port: the call it makes. */
  verb?: string
  /** On a linkedPort: the use case behind it, when the other hexagon has seated one. */
  useCaseName?: string
}

/** A chain left unfinished: `id` is the element missing what `kind` names. */
export interface FlowGap {
  kind: 'noAdapter' | 'noActor' | 'noDestination'
  hexId: string
  id: string
}

/** One use case end to end, as a single ordered walk: entries (caller → adapter → driving port), the use case,
 * then each call in port order (driven port → adapter → external system, or the linked hexagon's driving port). */
export interface Flow {
  useCaseId: string
  description?: string
  steps: FlowStep[]
  /** Names of who starts the flow: actors, and hexagons calling in across a link. */
  starters: string[]
  /** Names of where it ends: external systems, and hexagons it calls across a link. */
  destinations: string[]
  gaps: FlowGap[]
  /** Each linked port walked on through, as step indexes: `from` is the linked port, `end` the first step after
   * the use cases behind it. Empty unless the flow was walked `through`. */
  subflows: { from: number; end: number }[]
}

const portAt = (map: HexaMap, end: { hexagonId: string; portId: string }) => map.hexagons.find((h) => h.id === end.hexagonId)?.ports.find((p) => p.id === end.portId)

const titleOf = (map: HexaMap, hexId: string) => map.hexagons.find((h) => h.id === hexId)!.title

/** The flow of use case `useCaseId` in hexagon `hexId`; ports without a use case belong to no flow. Notes keyed by
 * an element since deleted are ignored. `through` carries on past a linked hexagon's driving port into the use
 * cases behind it, from their use case on, each walked once so a link back ends the walk instead of looping. */
export function flowOf(map: HexaMap, hexId: string, useCaseId: string, { through = false } = {}): Flow {
  const root = diagramOf(map, hexId).useCases.find((u) => u.id === useCaseId)!
  const flow: Flow = { useCaseId, description: root.description, steps: [], starters: [], destinations: [], gaps: [], subflows: [] }
  const walked = new Set<string>()
  const walk = (hexId: string, useCaseId: string, entered: boolean) => {
    walked.add(`${hexId} ${useCaseId}`)
    const d: Diagram = diagramOf(map, hexId)
    const useCase = d.useCases.find((u) => u.id === useCaseId)!
    const step = (role: FlowRole, item: { id: string; name: string; verb?: string }, at = hexId) =>
      flow.steps.push({ role, hexId: at, id: item.id, name: item.name, ...(at === hexId && useCase.stepNotes?.[item.id] ? { note: useCase.stepNotes[item.id] } : {}), ...(item.verb ? { verb: item.verb } : {}) })
    const gap = (kind: FlowGap['kind'], id: string) => flow.gaps.push({ kind, hexId, id })
    const portsOf = (side: Port['side']) => d.ports.filter((p) => p.side === side && useCasesOf(p).includes(useCaseId))

    // Entered across a link, the linked port already stands for the entry.
    for (const port of entered ? [] : portsOf('driving')) {
      const callers = map.links.filter((l) => l.to.hexagonId === hexId && l.to.portId === port.id && portAt(map, l.from))
      for (const { from } of callers) {
        step('linkedPort', portAt(map, from)!, from.hexagonId)
        flow.starters.push(titleOf(map, from.hexagonId))
      }
      const adapters = d.adapters.filter((a) => a.portId === port.id)
      if (!adapters.length && !callers.length) gap('noAdapter', port.id)
      for (const adapter of adapters) {
        const actors = d.actors.filter((a) => a.adapterId === adapter.id)
        if (!actors.length) gap('noActor', adapter.id)
        for (const actor of actors) {
          step('actor', actor)
          flow.starters.push(actor.name)
        }
        step('adapter', adapter)
      }
      step('drivingPort', port)
    }

    step('useCase', useCase)
    for (const id of useCase.aggregateIds ?? []) {
      const aggregate = d.domain.find((i) => i.id === id)
      if (aggregate) step('aggregate', aggregate)
    }

    for (const port of portsOf('driven')) {
      step('drivenPort', port)
      const adapters = d.adapters.filter((a) => a.portId === port.id)
      const calls = map.links.filter((l) => l.from.hexagonId === hexId && l.from.portId === port.id && portAt(map, l.to))
      if (!adapters.length && !calls.length) gap('noAdapter', port.id)
      for (const adapter of adapters) {
        step('drivenAdapter', adapter)
        const externals = d.externals.filter((e) => e.adapterId === adapter.id)
        if (!externals.length && !calls.length) gap('noDestination', adapter.id)
        for (const external of externals) {
          step('external', external)
          flow.destinations.push(external.name)
        }
      }
      for (const { to } of calls) {
        const target = diagramOf(map, to.hexagonId)
        const callee = portAt(map, to)!
        step('linkedPort', callee, to.hexagonId)
        flow.steps.at(-1)!.useCaseName = target.useCases.find((u) => u.id === useCasesOf(callee)[0])?.name
        flow.destinations.push(titleOf(map, to.hexagonId))
        if (!through) continue
        const from = flow.steps.length - 1
        for (const id of useCasesOf(callee))
          if (target.useCases.some((u) => u.id === id) && !walked.has(`${to.hexagonId} ${id}`)) walk(to.hexagonId, id, true)
        if (flow.steps.length > from + 1) flow.subflows.push({ from, end: flow.steps.length })
      }
    }
  }
  walk(hexId, useCaseId, false)
  return flow
}

/** The innermost subflow holding step `index` that has a step after it to skip to. */
export const subflowAt = (flow: Flow, index: number) =>
  flow.subflows.filter((s) => s.from <= index && index < s.end && s.end < flow.steps.length).sort((a, b) => a.end - a.from - (b.end - b.from))[0]

/** One flow per use case of the hexagon, in its order. */
export const flowsOf = (map: HexaMap, hexId: string): Flow[] => diagramOf(map, hexId).useCases.map((u) => flowOf(map, hexId, u.id))

/** The flow as the canvas's emphasis chain: its elements per hexagon, and the map links joining two of them. */
export function flowChain(map: HexaMap, flow: Flow): Chain {
  const elements = new Map<string, Set<string>>()
  for (const { hexId, id } of flow.steps) elements.set(hexId, (elements.get(hexId) ?? new Set()).add(id))
  const links = map.links.filter((l) => elements.get(l.from.hexagonId)?.has(l.from.portId) && elements.get(l.to.hexagonId)?.has(l.to.portId))
  return { elements, links: new Set(links.map((l) => l.id)) }
}
