import { z } from 'zod'

const id = z.string().min(1)
const note = z.string().optional()

export const KindSchema = z.enum(['hexagonal', 'clean', 'onion'])
export const DomainTypeSchema = z.enum(['entity', 'valueObject', 'aggregate', 'domainService'])
export const SideSchema = z.enum(['driving', 'driven'])
/** Hexagon walls a port can sit on: the driving half on the left, the driven half on the right. */
export const WallSchema = z.enum(['nw', 'w', 'sw', 'ne', 'e', 'se'])
export const DRIVING_WALLS: ReadonlySet<string> = new Set(['nw', 'w', 'sw'])
export const LayerRoleSchema = z.enum(['outer', 'adapters', 'application', 'domainServices', 'domain'])
const LayerTextSchema = z.object({ title: z.string().optional(), subtitle: z.string().optional() })

const DomainItemSchema = z.object({ id, name: z.string(), type: DomainTypeSchema, parentId: id.optional(), note })
// 'top' (the default) stacks a use case under the application title; a wall seats it in that wall's sector.
export const PlacementSchema = z.enum(['top', ...WallSchema.options])
const UseCaseSchema = z.object({ id, name: z.string(), placement: PlacementSchema.optional(), note })
const PortSchema = z.object({ id, name: z.string(), side: SideSchema, wall: WallSchema.optional(), useCaseId: id.optional(), note })
const AdapterSchema = z.object({ id, name: z.string(), portId: id.optional(), note })
const EndpointSchema = z.object({ id, name: z.string(), adapterId: id.optional(), note })

const DiagramObject = z.object({
  version: z.literal(1),
  kind: KindSchema,
  title: z.string(),
  subtitle: z.string().optional(),
  domain: z.array(DomainItemSchema),
  useCases: z.array(UseCaseSchema),
  ports: z.array(PortSchema),
  adapters: z.array(AdapterSchema),
  actors: z.array(EndpointSchema),
  externals: z.array(EndpointSchema),
  composition: z.object({ name: z.string(), note }).optional(),
  /** Per-layer title/subtitle overrides; an empty or missing value falls back to the kind's default. */
  layers: z.partialRecord(LayerRoleSchema, LayerTextSchema).optional(),
})

export const COLLECTIONS = ['domain', 'useCases', 'ports', 'adapters', 'actors', 'externals'] as const

/** [owner collection, foreign-key field, target collection] */
export const REFERENCES = [
  ['domain', 'parentId', 'domain'],
  ['ports', 'useCaseId', 'useCases'],
  ['adapters', 'portId', 'ports'],
  ['actors', 'adapterId', 'adapters'],
  ['externals', 'adapterId', 'adapters'],
] as const

export type Linkable = { id: string; parentId?: string; useCaseId?: string; portId?: string; adapterId?: string }

export const PARENT_TYPES: ReadonlySet<string> = new Set(['entity', 'aggregate'])

function checkIntegrity(d: Pick<z.infer<typeof DiagramObject>, CollectionKey>, ctx: z.RefinementCtx) {
  for (const key of COLLECTIONS) {
    const seen = new Set<string>()
    d[key].forEach((item, i) => {
      if (seen.has(item.id)) {
        ctx.addIssue({ code: 'custom', message: `Duplicate id "${item.id}"`, path: [key, i, 'id'] })
      }
      seen.add(item.id)
    })
  }
  for (const [owner, field, target] of REFERENCES) {
    const ids = new Set(d[target].map((t) => t.id))
    const items: Linkable[] = d[owner]
    items.forEach((item, i) => {
      const ref = item[field]
      if (ref !== undefined && !ids.has(ref)) {
        ctx.addIssue({ code: 'custom', message: `Unknown ${target} id "${ref}"`, path: [owner, i, field] })
      }
    })
  }
  d.ports.forEach((p, i) => {
    if (p.wall && DRIVING_WALLS.has(p.wall) !== (p.side === 'driving')) {
      const half = p.side === 'driving' ? 'nw, w or sw' : 'ne, e or se'
      ctx.addIssue({ code: 'custom', message: `A ${p.side} port sits on the ${half} wall`, path: ['ports', i, 'wall'] })
    }
  })
  const byId = new Map(d.domain.map((item) => [item.id, item]))
  d.domain.forEach((item, i) => {
    const parent = item.parentId ? byId.get(item.parentId) : undefined
    if (!parent) return
    if (!PARENT_TYPES.has(parent.type)) {
      ctx.addIssue({ code: 'custom', message: `A ${parent.type} cannot contain other domain items`, path: ['domain', i, 'parentId'] })
      return
    }
    const seen = new Set([item.id])
    let at: typeof parent | undefined = parent
    while (at) {
      if (seen.has(at.id)) {
        ctx.addIssue({ code: 'custom', message: `"${item.name}" is its own ancestor`, path: ['domain', i, 'parentId'] })
        return
      }
      seen.add(at.id)
      at = at.parentId ? byId.get(at.parentId) : undefined
    }
  })
}

// Zod 4 refuses to .extend() a refined object, so the refinement is applied to each variant.
export const DiagramSchema = DiagramObject.superRefine(checkIntegrity)
export const APP = 'domainrings'
export const VERSION = 2
// Files saved before the rename still open; parseHexa drops the marker, so they re-export under the current name.
// Frozen: the file format a v1 build wrote and still reads. Never change this schema — a data-bearing addition
// belongs on the v2 map instead.
export const HexaFileV1Schema = DiagramObject.extend({ app: z.enum([APP, 'archviz']) }).superRefine(checkIntegrity)

export type Diagram = z.infer<typeof DiagramSchema>

// --- v2: a map holds one or more hexagons, each keeping the v1 shape (minus version/kind, which move to the map). ---

const CellSchema = z.object({ q: z.int(), r: z.int() })
const ContextSchema = z.object({ id, name: z.string().optional() })
const HexagonObject = DiagramObject.omit({ version: true, kind: true }).extend({ id, contextId: id, cell: CellSchema })
export const LinkPatternSchema = z.enum(['acl', 'ohs-pl', 'customer-supplier', 'conformist', 'shared-kernel'])
const LinkEndSchema = z.object({ hexagonId: id, portId: id, adapterId: id.optional() })
const LinkSchema = z.object({ id, from: LinkEndSchema, to: LinkEndSchema, pattern: LinkPatternSchema.optional() })

const MapObject = z.object({
  version: z.literal(VERSION),
  kind: KindSchema,
  title: z.string(),
  contexts: z.array(ContextSchema).min(1),
  hexagons: z.array(HexagonObject.superRefine(checkIntegrity)).min(1),
  links: z.array(LinkSchema),
})

export type LinkEnd = z.infer<typeof LinkEndSchema>
export type Link = z.infer<typeof LinkSchema>
type MapShape = z.infer<typeof MapObject>

/** Why an end cannot stand: unknown hexagon, unknown port, wrong side for its role, adapter missing or not on that port. */
export function linkEndProblem(map: MapShape, end: LinkEnd, role: 'from' | 'to'): string | undefined {
  const hexagon = map.hexagons.find((h) => h.id === end.hexagonId)
  if (!hexagon) return `Unknown hexagon id "${end.hexagonId}"`
  const port = hexagon.ports.find((p) => p.id === end.portId)
  if (!port) return `Unknown port id "${end.portId}" on hexagon "${end.hexagonId}"`
  const wantSide: Side = role === 'from' ? 'driven' : 'driving'
  if (port.side !== wantSide) return `The ${role} end of a link must be a ${wantSide} port`
  if (end.adapterId !== undefined) {
    const adapter = hexagon.adapters.find((a) => a.id === end.adapterId)
    if (!adapter) return `Unknown adapter id "${end.adapterId}" on hexagon "${end.hexagonId}"`
    if (adapter.portId !== end.portId) return `Adapter "${end.adapterId}" is not attached to port "${end.portId}"`
  }
  return undefined
}

function checkMap(m: MapShape, ctx: z.RefinementCtx) {
  const seenContexts = new Set<string>()
  m.contexts.forEach((c, i) => {
    if (seenContexts.has(c.id)) ctx.addIssue({ code: 'custom', message: `Duplicate context id "${c.id}"`, path: ['contexts', i, 'id'] })
    seenContexts.add(c.id)
  })
  const seenHexagons = new Set<string>()
  m.hexagons.forEach((h, i) => {
    if (seenHexagons.has(h.id)) ctx.addIssue({ code: 'custom', message: `Duplicate hexagon id "${h.id}"`, path: ['hexagons', i, 'id'] })
    seenHexagons.add(h.id)
  })
  const seenCells = new Set<string>()
  m.hexagons.forEach((h, i) => {
    const key = `${h.cell.q},${h.cell.r}`
    if (seenCells.has(key)) ctx.addIssue({ code: 'custom', message: `Two hexagons share cell (${h.cell.q}, ${h.cell.r})`, path: ['hexagons', i, 'cell'] })
    seenCells.add(key)
  })
  m.hexagons.forEach((h, i) => {
    if (!seenContexts.has(h.contextId)) ctx.addIssue({ code: 'custom', message: `Unknown context id "${h.contextId}"`, path: ['hexagons', i, 'contextId'] })
  })
  if (m.hexagons.length > 1 && m.kind !== 'hexagonal') {
    ctx.addIssue({ code: 'custom', message: 'A map with more than one hexagon must be hexagonal', path: ['kind'] })
  }
  const seenLinks = new Set<string>()
  const seenPairs = new Set<string>()
  m.links.forEach((l, i) => {
    if (seenLinks.has(l.id)) ctx.addIssue({ code: 'custom', message: `Duplicate link id "${l.id}"`, path: ['links', i, 'id'] })
    seenLinks.add(l.id)
    const fromProblem = linkEndProblem(m, l.from, 'from')
    if (fromProblem) ctx.addIssue({ code: 'custom', message: fromProblem, path: ['links', i, 'from'] })
    const toProblem = linkEndProblem(m, l.to, 'to')
    if (toProblem) ctx.addIssue({ code: 'custom', message: toProblem, path: ['links', i, 'to'] })
    if (fromProblem || toProblem) return
    if (l.from.hexagonId === l.to.hexagonId) {
      ctx.addIssue({ code: 'custom', message: 'A link cannot join a hexagon to itself', path: ['links', i] })
    }
    const pairKey = `${l.from.hexagonId}:${l.from.portId}>${l.to.hexagonId}:${l.to.portId}`
    if (seenPairs.has(pairKey)) ctx.addIssue({ code: 'custom', message: 'Duplicate link between the same two ports', path: ['links', i] })
    seenPairs.add(pairKey)
    if (l.pattern) {
      const fromHexagon = m.hexagons.find((h) => h.id === l.from.hexagonId)!
      const toHexagon = m.hexagons.find((h) => h.id === l.to.hexagonId)!
      if (fromHexagon.contextId === toHexagon.contextId) {
        ctx.addIssue({ code: 'custom', message: 'A pattern only applies to a link crossing contexts', path: ['links', i, 'pattern'] })
      }
    }
  })
}

export const MapSchema = MapObject.superRefine(checkMap)
export const HexaFileV2Schema = MapObject.extend({ app: z.literal(APP) }).superRefine(checkMap)
export type HexaMap = z.infer<typeof MapSchema>
export type Hexagon = HexaMap['hexagons'][number]
export type Context = HexaMap['contexts'][number]
export type ArchitectureKind = z.infer<typeof KindSchema>
export type DomainType = z.infer<typeof DomainTypeSchema>
export type Side = z.infer<typeof SideSchema>
export type Wall = z.infer<typeof WallSchema>
export type Placement = z.infer<typeof PlacementSchema>
export const defaultWall = (side: Side): Wall => (side === 'driving' ? 'w' : 'e')
export type LayerRole = z.infer<typeof LayerRoleSchema>
export type DomainItem = z.infer<typeof DomainItemSchema>
export type UseCase = z.infer<typeof UseCaseSchema>
export type Port = z.infer<typeof PortSchema>
export type Adapter = z.infer<typeof AdapterSchema>
export type Endpoint = z.infer<typeof EndpointSchema>
export type CollectionKey = (typeof COLLECTIONS)[number]
