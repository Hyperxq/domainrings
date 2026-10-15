import { describe, expect, it } from 'vitest'
import { EXAMPLES } from '../model/example'
import { diagramOf } from '../model/map'
import type { HexaMap } from '../model/schema'
import { threadsOf, type Thread } from '../model/threads'
import { layoutDiagram, type LayoutEdge, type LayoutMode, type LayoutNode } from './layout'
import { markThreads } from './hexagon/threadMarks'

const example = (id: string) => EXAMPLES.find((e) => e.id === id)!.map as HexaMap
const CASES = (['hexagonal-basic', 'hexagonal-stress', 'hexagonal-advanced'] as const).flatMap((id) => (['detailed', 'overview'] as LayoutMode[]).map((mode) => [id, mode] as const))
const laid = (id: string, mode: LayoutMode, hexId = example(id).hexagons[0].id) => {
  const map = example(id)
  const threads = threadsOf(map, hexId)
  return { threads, model: layoutDiagram(diagramOf(map, hexId), { mode, threads }) }
}
const owners = (threads: Thread[], e: LayoutEdge) => {
  return threads.filter((t) => t.refs.has(e.from!) && (e.to === undefined || t.refs.has(e.to)))
}

describe('thread marks on the hexagonal layout', () => {
  it.each(CASES)('%s %s: every import edge names the elements it joins', (id, mode) => {
    const { model } = laid(id, mode)
    const refs = new Set(model.nodes.map((n) => n.ref))
    for (const edge of model.edges.filter((e) => e.kind === 'import')) {
      expect(refs.has(edge.from!), edge.key).toBe(true)
      if (edge.to !== undefined) expect(refs.has(edge.to), edge.key).toBe(true)
    }
    if (mode === 'detailed') expect(model.edges.some((e) => e.kind === 'import' && e.key.includes('->aggregate:'))).toBe(true)
    expect(model.edges.filter((e) => e.kind === 'wiring').every((e) => e.from === undefined && e.to === undefined)).toBe(true)
  })

  it.each(CASES)('%s %s: every edge of exactly one thread carries it, every other edge stays neutral', (id, mode) => {
    const { threads, model } = laid(id, mode)
    const imports = model.edges.filter((e) => e.kind === 'import')
    expect(imports.length).toBeGreaterThan(0)
    for (const edge of imports) {
      const own = owners(threads, edge)
      expect(edge.thread, edge.key).toEqual(own.length === 1 ? { id: own[0].useCaseId, slot: own[0].slot } : undefined)
    }
    expect(model.edges.filter((e) => e.kind === 'wiring').every((e) => e.thread === undefined)).toBe(true)
  })

  it.each(CASES)('%s %s: every box shows a dot for each thread that touches it', (id, mode) => {
    const { threads, model } = laid(id, mode)
    const DOTTED = new Set(['actor', 'adapter', 'port', 'useCase', 'external', 'aggregate'])
    for (const node of model.nodes) {
      const touching = threads.filter((t) => t.refs.has(node.ref)).map((t) => ({ id: t.useCaseId, slot: t.slot }))
      expect(node.threads, `${node.kind}:${node.ref}`).toEqual(DOTTED.has(node.kind) && touching.length ? touching : undefined)
    }
  })

  it('marks something on the stress example', () => {
    const { model } = laid('hexagonal-stress', 'detailed')
    expect(model.edges.filter((e) => e.thread).length).toBeGreaterThan(10)
    expect(model.nodes.filter((n) => n.kind === 'useCase').every((n) => n.threads?.length === 1)).toBe(true)
  })

  it('leaves the layout bare without threads', () => {
    const map = example('hexagonal-basic')
    const model = layoutDiagram(diagramOf(map, map.hexagons[0].id))
    expect(model.edges.some((e) => 'thread' in e)).toBe(false)
    expect(model.nodes.some((n) => 'threads' in n)).toBe(false)
  })

  it('does not move anything', () => {
    const map = example('hexagonal-stress')
    const bare = layoutDiagram(diagramOf(map, map.hexagons[0].id))
    const marked = laid('hexagonal-stress', 'detailed').model
    const strip = (m: typeof bare) => ({ ...m, nodes: m.nodes.map(({ threads: _t, ...n }: LayoutNode) => n), edges: m.edges.map(({ thread: _t, ...e }: LayoutEdge) => e) })
    expect(strip(marked)).toEqual(strip(bare))
  })
})

describe('markThreads', () => {
  const node = (kind: LayoutNode['kind'], ref: string) => ({ key: `${kind}:${ref}`, ref, kind, tone: 'teal', lines: [], x: 0, y: 0, width: 1, height: 1 }) as LayoutNode
  const edge = (from: string, to?: string): LayoutEdge => ({ key: 'unrelated', kind: 'import', points: [], from, ...(to ? { to } : {}) })
  const thread = (useCaseId: string, slot: number, ...refs: string[]): Thread => ({ useCaseId, slot, refs: new Set(refs) })

  it('keeps an edge shared by several threads neutral', () => {
    const edges = [edge('a', 'p')]
    markThreads([], edges, [thread('u1', 1, 'a', 'p'), thread('u2', 2, 'a', 'p')])
    expect(edges[0].thread).toBeUndefined()
  })

  it('colours a use case ask into the domain by its own thread', () => {
    const edges = [edge('u1')]
    markThreads([], edges, [thread('u1', 4, 'u1'), thread('u2', 5, 'u2')])
    expect(edges[0].thread).toEqual({ id: 'u1', slot: 4 })
  })

  it('leaves a wiring edge, which names no elements, neutral', () => {
    const wiring: LayoutEdge = { key: 'composition->trunk:driving', kind: 'wiring', points: [] }
    markThreads([], [wiring], [thread('u1', 1, 'composition')])
    expect(wiring.thread).toBeUndefined()
  })

  it('lists the dots of a box in thread order', () => {
    const nodes = [node('aggregate', 'g')]
    markThreads(nodes, [], [thread('u1', 7, 'g'), thread('u2', 3, 'g'), thread('u3', 1)])
    expect(nodes[0].threads).toEqual([{ id: 'u1', slot: 7 }, { id: 'u2', slot: 3 }])
  })

  it('gives no dots to the composition root or a thread-less box', () => {
    const nodes = [node('composition', 'p'), node('adapter', 'z')]
    markThreads(nodes, [], [thread('u1', 0, 'p')])
    expect(nodes.every((n) => n.threads === undefined)).toBe(true)
  })
})

describe('a port shared by several use cases', () => {
  it('draws one line from each use case to the port, in that use case’s thread colour', () => {
    const map = example('hexagonal-basic')
    const hex = map.hexagons[0]
    const shared = {
      ...map,
      hexagons: [{ ...hex, useCases: [...hex.useCases, { id: 'uc-other', name: 'Other', threadSlot: 9 }], ports: hex.ports.map((p) => (p.id === 'p-repo' ? { ...p, useCaseId: undefined, useCaseIds: ['uc-submit', 'uc-other'] } : p)) }],
    }
    const threads = threadsOf(shared, hex.id)
    const slotOf = (id: string) => threads.find((t) => t.useCaseId === id)!.slot
    const { edges } = layoutDiagram(diagramOf(shared, hex.id), { threads })
    const lines = edges.filter((e) => e.kind === 'import' && e.to === 'p-repo' && e.from?.startsWith('uc-'))
    expect(lines.map((e) => [e.from, e.thread])).toEqual([
      ['uc-submit', { id: 'uc-submit', slot: slotOf('uc-submit') }],
      ['uc-other', { id: 'uc-other', slot: 9 }],
    ])
  })
})
