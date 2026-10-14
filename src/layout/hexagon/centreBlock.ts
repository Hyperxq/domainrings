import { HEXAGONAL_KIND } from '../../model/kinds'
import type { Diagram, DomainItem, Wall } from '../../model/schema'
import { reach, type Point } from '../geometry'
import type { NodeKind } from '../layout'
import { COS30, halfWidthAt, hexagon, type Outline } from '../outline'
import { DOMAIN_TAGS } from '../tags'
import { styled } from '../text'
import { frame, type Frame } from './boxFrames'
import type { UseCaseSeating } from './useCaseSeating'
import { WALLS, wallFrame } from './walls'

/** An aggregate outline: 8 padding all round, plus its tag line above the root. */
const OUTLINE_PAD = 8
/** Room kept between two blocks of the region. */
const BLOCK_GAP = 10
/** Room kept between a block and the wall of the region it sits on. */
const REGION_PAD = 6
/** A region this large holds any block, so a search that gets here has a bug. */
const MAX_REGION = 1e5
/** The smallest region, so an empty domain still has a body under its title. */
const MIN_REGION = 40
/** A block that belongs to no face stays in the middle of the region. */
const MIDDLE = 'middle'
type Face = Wall | typeof MIDDLE
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
}
/** A root and its descendants, kept together; an aggregate root also gets an outline around the block. */
interface Block {
  root: DomainItem
  rows: Row[]
  aggregate?: DomainItem
}
/** A box of the domain at its final place; `x` and `y` are its centre. */
export interface Placed extends Row {
  x: number
  y: number
}

const inside = (o: Outline, p: Point) => Math.abs(p.y) <= o.apex + 1e-6 && Math.abs(p.x) <= halfWidthAt(o, p.y) + 1e-6
const corners = (c: Point, w: number, h: number) => [-1, 1].flatMap((sx) => [-1, 1].map((sy) => ({ x: c.x + (sx * w) / 2, y: c.y + (sy * h) / 2 })))
const apart = (a: { c: Point; w: number; h: number }, b: { c: Point; w: number; h: number }) =>
  Math.abs(a.c.x - b.c.x) >= (a.w + b.w) / 2 + BLOCK_GAP - 1e-6 || Math.abs(a.c.y - b.c.y) >= (a.h + b.h) / 2 + BLOCK_GAP - 1e-6

/**
 * The domain body: the domain model region, a hexagon of its own inside the domain ring, holding one card per
 * aggregate on the face toward the use cases that use it, and every other root as plain text. What no use case points
 * at spreads evenly over the faces. The region is the smallest one in which everything fits clear of the rest.
 */
export function layCentre({ d, overview, domainFrame, seating }: CentreInput) {
  const config = HEXAGONAL_KIND
  const splitServices = config.rings.some((r) => r.role === 'domainServices')
  const coreItems = d.domain.filter((i) => !splitServices || i.type !== 'domainService')
  const serviceItems = splitServices ? d.domain.filter((i) => i.type === 'domainService') : []
  const serviceFrames = serviceItems.map(domainFrame)
  const coreIds = new Set(coreItems.map((i) => i.id))
  const childrenOf = (id: string | undefined) =>
    coreItems.filter((i) => (i.parentId && coreIds.has(i.parentId) ? i.parentId : undefined) === id)
  const itemFrame = (item: DomainItem, depth: number) =>
    depth === 0 ? domainFrame(item) : frame([{ text: item.name, style: 'minor', tag: DOMAIN_TAGS[item.type] }], 0, 2, 0)
  const walk = (item: DomainItem, depth: number): Row[] => [
    { key: `domainItem:${item.id}`, ref: item.id, kind: 'domainItem', frame: itemFrame(item, depth) },
    ...childrenOf(item.id).flatMap((child) => walk(child, depth + 1)),
  ]
  const roots = childrenOf(undefined)
  const blocks: Block[] = overview
    ? // The overview domain is a plain list of its aggregate and entity roots.
      roots
        .filter((r) => r.type === 'aggregate' || r.type === 'entity')
        .map((root) => ({ root, rows: [{ key: `domainItem:${root.id}`, ref: root.id, kind: 'domainItem', frame: frame(styled(root.type === 'aggregate' ? 'strong' : 'mono', root.name), 0, 2, 0) }] }))
    : [...roots.filter((r) => r.type !== 'domainService'), ...roots.filter((r) => r.type === 'domainService')].map((root) => ({
        root,
        rows: walk(root, 0),
        aggregate: root.type === 'aggregate' ? root : undefined,
      }))

  const tagFrame = frame(styled('tag', DOMAIN_TAGS.aggregate), 0, 0, 0)
  const blockSize = (b: Block) => {
    const width = Math.max(0, ...b.rows.map((r) => r.frame.width))
    const height = b.rows.reduce((h, r) => h + r.frame.height, 0)
    return b.aggregate
      ? { width: Math.max(width, tagFrame.width) + 2 * OUTLINE_PAD, height: height + tagFrame.height + 2 * OUTLINE_PAD }
      : { width, height }
  }
  /** The block's boxes, its top edge at `top` and its middle at `x`. */
  const boxesOf = (block: Block, x: number, top: number): Placed[] => {
    const size = blockSize(block)
    let rowTop = top + (block.aggregate ? OUTLINE_PAD + tagFrame.height : 0)
    const outline: Placed[] = block.aggregate
      ? [{ key: `aggregate:${block.aggregate.id}`, ref: block.aggregate.id, kind: 'aggregate', frame: { lines: tagFrame.lines, width: size.width, height: size.height }, x, y: top + size.height / 2 }]
      : []
    const rows = block.rows.map((r) => {
      const placed = { ...r, x, y: rowTop + r.frame.height / 2 }
      rowTop += r.frame.height
      return placed
    })
    return [...outline, ...rows]
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
  const layBlocks = (apex: number, faces: ReadonlyMap<Block, Face>) => {
    const apothem = hexagon(apex).halfWidth - REGION_PAD
    const room = hexagon(apex - REGION_PAD / COS30)
    const middle = [...faces].filter(([, w]) => w === MIDDLE).map(([b]) => b)
    const stacked = middle.map((block) => ({ block, size: blockSize(block) }))
    let top = -stacked.reduce((t, it) => t + it.size.height + BLOCK_GAP, -BLOCK_GAP) / 2
    const inMiddle = stacked.map((it) => {
      const c = { x: 0, y: top + it.size.height / 2 }
      top += it.size.height + BLOCK_GAP
      return { ...it, c }
    })
    return [...inMiddle, ...WALLS.flatMap((wall) => {
      const here = [...faces].filter(([, w]) => w === wall).map(([b]) => b)
      if (!here.length) return []
      const { n, dir } = wallFrame(wall)
      const items = here.map((block) => {
        const size = blockSize(block)
        return { block, size, along: reach(size.width, size.height, dir), across: reach(size.width, size.height, n) }
      })
      // Side by side along the face, centred on it.
      const span = items.reduce((t, it) => t + 2 * it.along + BLOCK_GAP, -BLOCK_GAP)
      let start = -span / 2
      return items.map((it) => {
        const u = start + it.along
        start += 2 * it.along + BLOCK_GAP
        const at = (depth: number) => ({ x: n.x * depth + dir.x * u, y: n.y * depth + dir.y * u })
        let depth = apothem - it.across
        while (depth > 0 && !corners(at(depth), it.size.width, it.size.height).every((p) => inside(room, p))) depth -= 2
        return { ...it, c: at(Math.max(depth, 0)) }
      })
    })]
  }
  const fits = (apex: number, faces: ReadonlyMap<Block, Face>) => {
    const room = hexagon(apex - REGION_PAD / COS30)
    const items = layBlocks(apex, faces).map((it) => ({ c: it.c, w: it.size.width, h: it.size.height }))
    return items.every((it, i) => corners(it.c, it.w, it.h).every((p) => inside(room, p)) && items.slice(i + 1).every((o) => apart(it, o)))
  }
  /** The smallest region, at least `from` across, that holds the blocks on these faces. */
  const smallest = (faces: ReadonlyMap<Block, Face>, from: number) => {
    let apex = from
    while (apex < MAX_REGION && !fits(apex, faces)) apex = Math.ceil(apex * 1.01)
    if (apex >= MAX_REGION) throw new Error('The domain model region has no size that holds its blocks')
    return apex
  }
  // What no use case points at takes, one block at a time and the largest first, the face that keeps the region smallest
  // (the first of SPREAD wins a tie, so equal blocks spread evenly); then each is offered every other face in turn,
  // until no move makes the region smaller.
  const free = blocks.filter((b) => !wallOf.has(b)).sort((a, b) => blockSize(b).width * blockSize(b).height - blockSize(a).width * blockSize(a).height)
  const faces = new Map<Block, Face>(wallOf)
  let apex = smallest(faces, MIN_REGION)
  const optionsOf = (block: Block): Face[] => (block.root.type === 'aggregate' ? SPREAD : [...SPREAD, MIDDLE])
  const settle = (block: Block, from: number) => {
    const tried = optionsOf(block).map((face) => ({ face, apex: smallest(new Map(faces).set(block, face), from) }))
    return tried.reduce((a, b) => (b.apex < a.apex ? b : a))
  }
  for (const block of free) {
    const best = settle(block, apex)
    faces.set(block, best.face)
    apex = best.apex
  }
  for (let pass = 0, moved = true; moved && pass < 3; pass++) {
    moved = false
    for (const block of free) {
      const [kept, best] = [faces.get(block)!, settle(block, MIN_REGION)]
      if (best.apex < apex) {
        faces.set(block, best.face)
        apex = best.apex
        moved = kept !== best.face
      }
    }
  }
  const boxes = layBlocks(apex, faces).flatMap((it) => boxesOf(it.block, it.c.x, it.c.y - it.size.height / 2))
  const servicesBlock = {
    width: Math.max(0, ...serviceFrames.map((f) => f.width)),
    height: serviceFrames.reduce((h, f) => h + f.height, 0),
  }
  return { boxes, faces: new Map([...faces].flatMap(([block, wall]): [string, Wall][] => (wall === MIDDLE ? [] : [[block.root.id, wall]]))), region: hexagon(apex), hasRegion: blocks.length > 0, serviceItems, serviceFrames, servicesBlock }
}

export type CentreBlock = ReturnType<typeof layCentre>
