import { HEXAGONAL_KIND } from '../../model/kinds'
import type { Diagram, DomainItem } from '../../model/schema'
import type { NodeKind } from '../layout'
import { depthAt, type Outline } from '../outline'
import { DOMAIN_TAGS } from '../tags'
import { styled } from '../text'
import { frame, type Frame } from './boxFrames'
import { COLUMN_GAP, DOMAIN_PAD } from './spacing'

/** Past these rendered line counts the domain tree, then the declared-port list, flow into two columns. */
const DOMAIN_MAX_LINES = 8
const PORTS_MAX_LINES = 4
/** An aggregate outline: 8 padding all round, plus its tag line above the root. */
const OUTLINE_PAD = 8
const BLOCK_GAP = 6

export interface CentreInput {
  d: Diagram
  overview: boolean
  domainFrame: (i: DomainItem) => Frame
  titles: { titleHeight: (i: number) => number; titleDepth: number }
}

export function layCentre({ d, overview, domainFrame, titles: { titleHeight, titleDepth } }: CentreInput) {
  const config = HEXAGONAL_KIND
  const last = config.rings.length - 1
  // Centre blocks. The domain tree is drawn as centred lines: a root shows its name and type, each descendant
  // one smaller line. Past DOMAIN_MAX_LINES the tree flows into two balanced columns, never splitting a root from
  // its descendants; a declared-port list longer than PORTS_MAX_LINES splits the same way.
  const splitServices = config.rings.some((r) => r.role === 'domainServices')
  const coreItems = d.domain.filter((i) => !splitServices || i.type !== 'domainService')
  const serviceItems = splitServices ? d.domain.filter((i) => i.type === 'domainService') : []
  const serviceFrames = serviceItems.map(domainFrame)
  const coreIds = new Set(coreItems.map((i) => i.id))
  const childrenOf = (id: string | undefined) =>
    coreItems.filter((i) => (i.parentId && coreIds.has(i.parentId) ? i.parentId : undefined) === id)
  interface Row {
    key: string
    ref: string
    kind: NodeKind
    frame: Frame
  }
  const itemFrame = (item: DomainItem, depth: number) =>
    depth === 0 ? domainFrame(item) : frame([{ text: item.name, style: 'minor', tag: DOMAIN_TAGS[item.type] }], 0, 2, 0)
  const walk = (item: DomainItem, depth: number): Row[] => [
    { key: `domainItem:${item.id}`, ref: item.id, kind: 'domainItem', frame: itemFrame(item, depth) },
    ...childrenOf(item.id).flatMap((child) => walk(child, depth + 1)),
  ]
  /** A root and its descendants, kept together; an aggregate root also gets an outline around the block. */
  interface Block {
    rows: Row[]
    aggregate?: DomainItem
  }
  const roots = childrenOf(undefined)
  const treeBlocks: Block[] = overview
    ? // The overview domain is a plain list of its aggregate and entity roots.
      roots
        .filter((r) => r.type === 'aggregate' || r.type === 'entity')
        .map((r) => ({ rows: [{ key: `domainItem:${r.id}`, ref: r.id, kind: 'domainItem', frame: frame(styled(r.type === 'aggregate' ? 'strong' : 'mono', r.name), 0, 2, 0) }] }))
    : [...roots.filter((r) => r.type !== 'domainService'), ...roots.filter((r) => r.type === 'domainService')].map((r) => ({
        rows: walk(r, 0),
        aggregate: r.type === 'aggregate' ? r : undefined,
      }))
  const declared = config.drivenPortNote && !overview ? d.ports.filter((p) => p.side === 'driven') : []
  const portBlocks: Block[] = declared.map((p) => ({
    rows: [{ key: `portDecl:${p.id}`, ref: p.id, kind: 'portDecl', frame: frame(styled('mono', p.name), 0, 2, 0) }],
  }))

  // The domain block hangs from its title: `top` is measured from the title's top, `x` is a column centre.
  interface Placed extends Row {
    x: number
    top: number
  }
  const tagFrame = frame(styled('tag', DOMAIN_TAGS.aggregate), 0, 0, 0)
  const blockSize = (b: Block) => {
    const width = Math.max(0, ...b.rows.map((r) => r.frame.width))
    const height = b.rows.reduce((h, r) => h + r.frame.height, 0)
    return b.aggregate
      ? { width: Math.max(width, tagFrame.width) + 2 * OUTLINE_PAD, height: height + tagFrame.height + 2 * OUTLINE_PAD }
      : { width, height }
  }
  const lineCount = (blocks: Block[]) => blocks.reduce((n, b) => n + b.rows.reduce((k, r) => k + r.frame.lines.length, 0), 0)
  const columnsOf = (blocks: Block[], maxLines: number): Block[][] => {
    const total = lineCount(blocks)
    if (total <= maxLines || blocks.length < 2) return [blocks]
    // Order-preserving split at the block boundary with the most even line counts.
    let split = 1
    for (let k = 2; k < blocks.length; k++) {
      if (Math.abs(total - 2 * lineCount(blocks.slice(0, k))) < Math.abs(total - 2 * lineCount(blocks.slice(0, split)))) split = k
    }
    return [blocks.slice(0, split), blocks.slice(split)]
  }
  const layColumns = (columns: Block[][], top: number) => {
    const widths = columns.map((c) => Math.max(0, ...c.map((b) => blockSize(b).width)))
    let left = -(widths.reduce((a, b) => a + b, 0) + COLUMN_GAP * (columns.length - 1)) / 2
    const rows: Placed[] = []
    const outlines: Placed[] = []
    let height = 0
    columns.forEach((column, c) => {
      const x = left + widths[c] / 2
      let y = top
      column.forEach((block, k) => {
        if (k > 0 && (block.aggregate || column[k - 1].aggregate)) y += BLOCK_GAP
        const size = blockSize(block)
        if (block.aggregate) {
          const outline = { lines: tagFrame.lines, width: size.width, height: size.height }
          outlines.push({ key: `aggregate:${block.aggregate.id}`, ref: block.aggregate.id, kind: 'aggregate', frame: outline, x, top: y })
        }
        let rowTop = y + (block.aggregate ? OUTLINE_PAD + tagFrame.height : 0)
        for (const r of block.rows) {
          rows.push({ ...r, x, top: rowTop })
          rowTop += r.frame.height
        }
        y += size.height
      })
      height = Math.max(height, y - top)
      left += widths[c] + COLUMN_GAP
    })
    return { rows, outlines, height }
  }
  const tree = layColumns(columnsOf(treeBlocks, DOMAIN_MAX_LINES), titleHeight(last) + 8)
  const header: Row | undefined =
    config.drivenPortNote && portBlocks.length
      ? { key: 'note:driven-ports', ref: 'driven-ports', kind: 'note', frame: frame(styled('mono', config.drivenPortNote.title), 0, 2, 0) }
      : undefined
  const headerTop = titleHeight(last) + 8 + tree.height + (tree.rows.length ? 6 : 0)
  const portList = layColumns(columnsOf(portBlocks, PORTS_MAX_LINES), headerTop + (header?.frame.height ?? 0))
  const coreRows: Placed[] = [...tree.rows, ...(header ? [{ ...header, x: 0, top: headerTop }] : []), ...portList.rows]
  const coreBoxes: Placed[] = [...tree.outlines, ...coreRows]
  const servicesBlock = {
    width: Math.max(0, ...serviceFrames.map((f) => f.width)),
    height: serviceFrames.reduce((h, f) => h + f.height, 0),
  }

  // A hexagon is no wider at a fixed depth under its vertex however big it grows, so a box too wide for the slope
  // just under the title can only fit lower: the body (never the title) drops until every box clears the slope.
  const bodyShift = (o: Outline) =>
    Math.max(0, ...coreBoxes.map((r) => depthAt(o, Math.abs(r.x) + r.frame.width / 2 + DOMAIN_PAD) - (titleDepth + r.top)))
  return { boxes: coreBoxes, serviceItems, serviceFrames, servicesBlock, declared, bodyShift }
}

export type CentreBlock = ReturnType<typeof layCentre>
