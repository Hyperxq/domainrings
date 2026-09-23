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

function checkIntegrity(d: z.infer<typeof DiagramObject>, ctx: z.RefinementCtx) {
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
// Files saved before the rename still open; parseHexa drops the marker, so they re-export under the current name.
export const HexaFileSchema = DiagramObject.extend({ app: z.enum([APP, 'archviz']) }).superRefine(checkIntegrity)

export type Diagram = z.infer<typeof DiagramSchema>
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
