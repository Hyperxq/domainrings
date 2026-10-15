import type { Diagram, DomainItem, Wall } from '../../model/schema'
import { reach, type Point } from '../geometry'
import type { NodeKind } from '../layout'
import { COS30, halfWidthAt, hexagon, type Outline } from '../outline'
import { cardHeader, DOMAIN_TAGS, ROW_TYPES } from '../tags'
import { frame, type Frame } from './boxFrames'
import type { UseCaseSeating } from './useCaseSeating'
import { WALLS, wallFrame } from './walls'

/** Room between a card's edge and its text, and above its header and below its last row. */
const CARD_PAD_X = 12
const CARD_TOP = 4
const CARD_BOTTOM = 6
/** Room around the divider between a card's name and its rows. */
const RULE_GAP = 4
/** Room kept between two blocks of the region. */
const BLOCK_GAP = 8
/** Room kept between a block and the wall of the region it sits on. */
const REGION_PAD = 6
/** The largest region the search tries: past it the layout keeps this size and lets blocks stick out, rather than fail. */
const MAX_REGION = 1e5
/** The smallest region, so an empty domain still has a body under its title. */
const MIN_REGION = 40
/** Blocks nobody points at spread over the walls in this order: the first two face each other. */
const SPREAD: Wall[] = ['w', 'e', 'ne', 'sw', 'nw', 'se']

export interface CentreInput {
  d: Diagram
  overview: boolean
  domainFrame: (i: DomainItem) => Frame
  seating: UseCaseSeating
}

interface Row {
  key: string
  ref: string
  kind: NodeKind
  frame: Frame
  align?: 'center' | 'start'
}
/** A root and its descendants, kept together as one card: its type header, its name, then a row per descendant. */
interface Block {
  root: DomainItem
  header: Frame
  name: Frame
  rows: Row[]
}
/** A box of the domain at its final place; `x` and `y` are its centre. */
export interface Placed extends Row {
  x: number
  y: number
  rule?: number
}

const inside = (o: Outline, p: Point) => Math.abs(p.y) <= o.apex + 1e-6 && Math.abs(p.x) <= halfWidthAt(o, p.y) + 1e-6
const corners = (c: Point, w: number, h: number) => [-1, 1].flatMap((sx) => [-1, 1].map((sy) => ({ x: c.x + (sx * w) / 2, y: c.y + (sy * h) / 2 })))
const apart = (a: { c: Point; w: number; h: number }, b: { c: Point; w: number; h: number }) =>
  Math.abs(a.c.x - b.c.x) >= (a.w + b.w) / 2 + BLOCK_GAP - 1e-6 || Math.abs(a.c.y - b.c.y) >= (a.h + b.h) / 2 + BLOCK_GAP - 1e-6

/**
 * The domain body: the domain model region, a hexagon of its own inside the domain ring, holding one card per
 * aggregate on the face toward the use cases that use it, and a card of the same shape for every other root. What no use case points
 * at spreads evenly over the faces. The region is the smallest one in which everything fits clear of the rest.
 */
export function layCentre({ d, overview, domainFrame, seating }: CentreInput) {
  const coreIds = new Set(d.domain.map((i) => i.id))
  const childrenOf = (id: string | undefined) =>
    d.domain.filter((i) => (i.parentId && coreIds.has(i.parentId) ? i.parentId : undefined) === id)
  const rowsOf = (item: DomainItem): Row[] =>
    childrenOf(item.id).flatMap((child) => [
      { key: `domainItem:${child.id}`, ref: child.id, kind: 'domainItem' as const, align: 'start' as const, frame: frame([{ text: `${DOMAIN_TAGS[child.type].split(' ')[0]} ${child.name}`, style: 'minor', right: ROW_TYPES[child.type] }], 0, 1, 0) },
      ...rowsOf(child),
    ])
  const roots = childrenOf(undefined)
  // Overview keeps every card where Detailed has it; an aggregate just shrinks to its header and name.
  const blocks: Block[] = [...roots.filter((r) => r.type !== 'domainService'), ...roots.filter((r) => r.type === 'domainService')].map((root) => ({
    root,
    header: frame([{ text: cardHeader(root.type), style: 'tag' }], 0, 0, 0),
    name: domainFrame(root),
    rows: overview && root.type === 'aggregate' ? [] : rowsOf(root),
  }))

  // Every card of the hexagon is as wide as the widest.
  const cardWidth = Math.max(0, ...blocks.flatMap((b) => [b.header.width, b.name.width, ...b.rows.map((r) => r.frame.width)])) + 2 * CARD_PAD_X
  const inner = cardWidth - 2 * CARD_PAD_X
  const headHeight = (b: Block) => CARD_TOP + b.header.height + b.name.height
  const blockSize = (b: Block) => ({
    width: cardWidth,
    height: headHeight(b) + (b.rows.length ? RULE_GAP + b.rows.reduce((h, r) => h + r.frame.height, 0) : 0) + CARD_BOTTOM,
  })
  /** The block's boxes, its top edge at `top` and its middle at `x`. */
  const boxesOf = (block: Block, x: number, top: number): Placed[] => {
    const size = blockSize(block)
    const { id } = block.root
    let rowTop = top + headHeight(block) + RULE_GAP
    const card: Placed = { key: `aggregate:${id}`, ref: id, kind: 'aggregate', align: 'center', frame: { lines: block.header.lines, ...size }, x, y: top + size.height / 2, ...(block.rows.length ? { rule: headHeight(block) + RULE_GAP / 2 } : {}) }
    const name: Placed = { key: `domainItem:${id}`, ref: id, kind: 'domainItem', align: 'center', frame: { ...block.name, width: inner }, x, y: top + CARD_TOP + block.header.height + block.name.height / 2 }
    const rows = block.rows.map((r) => {
      const placed = { ...r, frame: { ...r.frame, width: inner }, x, y: rowTop + r.frame.height / 2 }
      rowTop += r.frame.height
      return placed
    })
    return [card, name, ...rows]
  }

  // Each block's face: the one most of the use cases using it are seated on.
  const users = (block: Block) => d.useCases.flatMap((u, i) => (u.aggregateIds?.includes(block.root.id) ? [i] : []))
  const wallOf = new Map<Block, Wall>()
  for (const block of blocks) {
    const counts = new Map<Wall, number>()
    for (const i of users(block)) counts.set(seating.walls[i], (counts.get(seating.walls[i]) ?? 0) + 1)
    const best = Math.max(0, ...counts.values())
    const wall = best ? WALLS.find((w) => counts.get(w) === best) : undefined
    if (wall) wallOf.set(block, wall)
  }

  /**
   * The blocks for a region of apex `apex`: each as far toward its face as its corners allow (against the wall where it
   * fits there, drawn in toward the middle where its height would stick out of the slope), the blocks sharing a face
   * side by side along it.
   */
  const layBlocks = (apex: number, faces: ReadonlyMap<Block, Wall>) => {
    const apothem = hexagon(apex).halfWidth - REGION_PAD
    const room = hexagon(apex - REGION_PAD / COS30)
    return WALLS.flatMap((wall) => {
      const here = [...faces].filter(([, w]) => w === wall).map(([b]) => b)
      if (!here.length) return []
      const { n, dir } = wallFrame(wall)
      const items = here.map((block) => {
        const size = blockSize(block)
        return { block, size, across: reach(size.width, size.height, n) }
      })
      // Side by side along the face, centred on it, each a full block clear of the last whichever way the face runs.
      const step = (a: (typeof items)[number], b: (typeof items)[number]) =>
        Math.min(Math.abs(dir.x) > 1e-9 ? ((a.size.width + b.size.width) / 2 + BLOCK_GAP) / Math.abs(dir.x) : Infinity, Math.abs(dir.y) > 1e-9 ? ((a.size.height + b.size.height) / 2 + BLOCK_GAP) / Math.abs(dir.y) : Infinity)
      const offsets = items.reduce<number[]>((acc, it, k) => [...acc, k ? acc[k - 1] + step(items[k - 1], it) : 0], [])
      return items.map((it, k) => {
        const u = offsets[k] - offsets[offsets.length - 1] / 2
        const at = (depth: number) => ({ x: n.x * depth + dir.x * u, y: n.y * depth + dir.y * u })
        let depth = apothem - it.across
        while (depth > 0 && !corners(at(depth), it.size.width, it.size.height).every((p) => inside(room, p))) depth -= 2
        return { ...it, c: at(Math.max(depth, 0)) }
      })
    })
  }
  const fits = (apex: number, faces: ReadonlyMap<Block, Wall>) => {
    const room = hexagon(apex - REGION_PAD / COS30)
    const items = layBlocks(apex, faces).map((it) => ({ c: it.c, w: it.size.width, h: it.size.height }))
    return items.every((it, i) => corners(it.c, it.w, it.h).every((p) => inside(room, p)) && items.slice(i + 1).every((o) => apart(it, o)))
  }
  /** The smallest region, at least `from` across, that holds the blocks on these faces; the largest one allowed when none does. */
  const smallest = (faces: ReadonlyMap<Block, Wall>, from: number) => {
    let apex = Math.min(from, MAX_REGION)
    // A region only gets roomier as it grows, so blocks that do not fit the largest one fit none: skip the walk.
    if (!fits(MAX_REGION, faces)) return MAX_REGION
    while (apex < MAX_REGION && !fits(apex, faces)) apex = Math.min(Math.ceil(apex * 1.01), MAX_REGION)
    return apex
  }
  // What no use case points at takes, one block at a time, the face that keeps the region smallest (the first of
  // SPREAD wins a tie, so equal blocks spread evenly); then each is offered every other face in turn, until no move
  // makes the region smaller.
  const free = blocks.filter((b) => !wallOf.has(b)).sort((a, b) => blockSize(b).width * blockSize(b).height - blockSize(a).width * blockSize(a).height)
  const search = (order: Block[]) => {
    const faces = new Map<Block, Wall>(wallOf)
    let apex = smallest(faces, MIN_REGION)
    const settle = (block: Block, from: number) => {
      const tried = SPREAD.map((face) => ({ face, apex: smallest(new Map(faces).set(block, face), from) }))
      return tried.reduce((a, b) => (b.apex < a.apex ? b : a))
    }
    for (const block of order) {
      const best = settle(block, apex)
      faces.set(block, best.face)
      apex = best.apex
    }
    for (let pass = 0, moved = true; moved && pass < 3; pass++) {
      moved = false
      for (const block of order) {
        const [kept, best] = [faces.get(block)!, settle(block, MIN_REGION)]
        if (best.apex < apex) {
          faces.set(block, best.face)
          apex = best.apex
          moved ||= kept !== best.face
        }
      }
    }
    return { faces, apex }
  }
  const { faces, apex } = search(free)
  const boxes = layBlocks(apex, faces).flatMap((it) => boxesOf(it.block, it.c.x, it.c.y - it.size.height / 2))
  return { boxes, faces: new Map([...faces].map(([block, face]) => [block.root.id, face])), region: hexagon(apex), hasRegion: blocks.length > 0 }
}

export type CentreBlock = ReturnType<typeof layCentre>
