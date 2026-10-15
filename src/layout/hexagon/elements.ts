import { HEXAGONAL_KIND } from '../../model/kinds'
import type { Diagram, Side, Wall } from '../../model/schema'
import type { NodeKind, Tone } from '../layout'
import type { BoxFrames, Frame } from './boxFrames'
import type { ChainSlot } from './chains'
import type { UseCaseSeating } from './useCaseSeating'

/** The layers a thread crosses, innermost first: 0 the domain model, then use cases, ports, adapters and the endpoints outside. */
export type Layer = 0 | 1 | 2 | 3 | 4

/** A box that straddles the wall of its layer: use cases, ports, adapters, actors and externals. */
export interface Element {
  key: string
  ref: string
  kind: NodeKind
  tone: Tone
  layer: Exclude<Layer, 0>
  side?: Side
  wall: Wall
  /** Place along the wall; 0 is the middle of it. */
  u: number
  frame: Frame
}

/** Every use case, port, adapter and endpoint with its wall and place along it. */
export function placeElements(d: Diagram, frames: BoxFrames, slots: ChainSlot[], seating: UseCaseSeating): Element[] {
  const frameOf = (s: ChainSlot): Frame => {
    switch (s.kind) {
      case 'port':
        return frames.portFrame(d.ports.find((p) => p.id === s.ref)!)
      case 'adapter':
        return frames.adapterFrame(d.adapters.find((a) => a.id === s.ref)!, s.side)
      case 'actor':
        return frames.leafFrame(d.actors.find((e) => e.id === s.ref)!, s.side)
      case 'external':
        return frames.leafFrame(d.externals.find((e) => e.id === s.ref)!, s.side)
    }
  }
  const LAYER = { port: 2, adapter: 3, actor: 4, external: 4 } as const
  const TONE = (s: ChainSlot): Tone => (s.kind === 'port' ? 'teal' : s.kind === 'external' ? 'slate' : s.side)
  const useCases = seating.seats.map((seat): Element => {
    const u = d.useCases[seat.i]
    return { key: `useCase:${u.id}`, ref: u.id, kind: 'useCase', tone: 'teal', layer: 1, wall: seat.wall, u: seat.u, frame: seat.frame }
  })
  const rest = slots.map((s): Element => ({ key: s.key, ref: s.ref, kind: s.kind, tone: TONE(s), layer: LAYER[s.kind], side: s.side, wall: s.wall, u: s.u, frame: frameOf(s) }))
  return [...useCases, ...rest]
}

/** A connection between two boxes, and the thread (use case) it belongs to. */
export interface Pair {
  key: string
  from: string
  to: string
  fromRef: string
  /** Absent when it ends on the domain model itself. */
  toRef?: string
  label?: string
  owner: string
}

/**
 * Every connection of the diagram, each arrow pointing the way the dependency does: an actor calls its adapter, an
 * adapter calls or implements its port, a driving port runs its use case, a use case uses a driven port, and a use case
 * asks the aggregates it names (the domain as a whole when it names none).
 */
export function planPairs(d: Diagram, elements: Element[], cards: ReadonlySet<string>): Pair[] {
  const { labels } = HEXAGONAL_KIND
  const byKey = new Map(elements.map((e) => [e.key, e]))
  const useCaseIds = new Set(d.useCases.map((u) => u.id))
  const owners = (portId?: string) => {
    const port = d.ports.find((p) => p.id === portId)
    return port && port.useCaseId && useCaseIds.has(port.useCaseId) ? port.useCaseId : port ? `port:${port.id}` : undefined
  }
  const pairs: Pair[] = []
  const link = (from: Element, to: Element, owner: string, label?: string) =>
    pairs.push({ key: `${from.key}->${to.key}`, from: from.key, to: to.key, fromRef: from.ref, toRef: to.ref, owner, ...(label ? { label } : {}) })
  const leafKey = (side: Side, id: string) => `${side === 'driving' ? 'actor' : 'external'}:${id}`
  const adapterPairs = (adapterId: string, owner: string) => {
    const adapter = byKey.get(`adapter:${adapterId}`)!
    const leaves = (adapter.side === 'driving' ? d.actors : d.externals).filter((e) => e.adapterId === adapterId)
    for (const leaf of leaves) {
      const box = byKey.get(leafKey(adapter.side!, leaf.id))!
      if (adapter.side === 'driving') link(box, adapter, owner)
      else link(adapter, box, owner)
    }
  }
  for (const port of d.ports) {
    const box = byKey.get(`port:${port.id}`)!
    const owner = owners(port.id)!
    for (const adapter of d.adapters.filter((a) => a.portId === port.id)) {
      link(byKey.get(`adapter:${adapter.id}`)!, box, owner)
      adapterPairs(adapter.id, owner)
    }
    const useCase = byKey.get(`useCase:${port.useCaseId}`)
    if (useCase) {
      if (port.side === 'driving') link(box, useCase, owner, labels.runs)
      else link(useCase, box, owner, port.verb?.trim() || labels.uses)
    }
  }
  const ported = new Set(d.ports.map((p) => p.id))
  for (const adapter of d.adapters.filter((a) => !a.portId || !ported.has(a.portId))) adapterPairs(adapter.id, `adapter:${adapter.id}`)
  for (const useCase of d.useCases) {
    const box = byKey.get(`useCase:${useCase.id}`)!
    const named = [...new Set(useCase.aggregateIds)].filter((id) => cards.has(id))
    // The ask is said once per use case, on its first arrow; every arrow into a card is the same ask.
    named.forEach((id, i) => pairs.push({ key: `${box.key}->aggregate:${id}`, from: box.key, to: `aggregate:${id}`, fromRef: useCase.id, toRef: id, owner: useCase.id, ...(i ? {} : { label: labels.asks }) }))
    if (!named.length) pairs.push({ key: `${box.key}->domain`, from: box.key, to: 'domain', fromRef: useCase.id, owner: useCase.id, label: labels.asks })
  }
  return pairs
}
