import { z } from 'zod'
import { isInwardOrSame, outerRoleOf } from './rings'

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

const DiagramFields = {
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
}

// Live shape: no Diagram this build renders can be anything but Hexagonal (the Clean/Onion kind switcher is
// gone; native Onion is a wholly separate document, ADR-01) — kind narrows to the literal.
const DiagramObject = z.object({ version: z.literal(1), kind: z.literal('hexagonal'), ...DiagramFields })

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
/** The current, in-memory document version — the Hexagonal, Onion and Clean arms of `StoredFile` share it
 * (ADR-01/ADR-03: one version number per document, not a per-kind counter). */
export const VERSION = 4
// Files saved before the rename still open; parseHexa drops the marker, so they re-export under the current name.
// Frozen: the file format a v1 build wrote and still reads — including a Clean/Onion `kind` from the old kind
// switcher (REQ-06 coerces it back to hexagonal in parseHexa, it does not touch what a v1 file is allowed to
// contain). Never change this schema — a data-bearing addition belongs on the v3 map instead.
const LegacyDiagramObject = z.object({ version: z.literal(1), kind: KindSchema, ...DiagramFields })
export const HexaFileV1Schema = LegacyDiagramObject.extend({ app: z.enum([APP, 'archviz']) }).superRefine(checkIntegrity)

export type Diagram = z.infer<typeof DiagramSchema>
/** The wider, as-stored shape a v1 file may carry (any of the 3 legacy kinds) — kept distinct from the live
 * `Diagram` type (kind narrowed to 'hexagonal') so a genuinely non-hexagonal legacy file still parses. */
export type LegacyDiagram = z.infer<typeof LegacyDiagramObject>

// --- v2/v3: a map holds one or more hexagons, each keeping the v1 shape (minus version/kind, which move to the map). ---

const CellSchema = z.object({ q: z.int(), r: z.int() })
const ContextSchema = z.object({ id, name: z.string().optional() })
const HexagonObject = DiagramObject.omit({ version: true, kind: true }).extend({ id, contextId: id, cell: CellSchema })
export const LinkPatternSchema = z.enum(['acl', 'ohs-pl', 'customer-supplier', 'conformist', 'shared-kernel'])
const LinkEndSchema = z.object({ hexagonId: id, portId: id, adapterId: id.optional() })
const LinkSchema = z.object({ id, from: LinkEndSchema, to: LinkEndSchema, pattern: LinkPatternSchema.optional() })

export type Context = z.infer<typeof ContextSchema>
export type Hexagon = z.infer<typeof HexagonObject>
export type LinkEnd = z.infer<typeof LinkEndSchema>
export type Link = z.infer<typeof LinkSchema>

const MapFields = {
  title: z.string(),
  contexts: z.array(ContextSchema).min(1),
  hexagons: z.array(HexagonObject.superRefine(checkIntegrity)).min(1),
  links: z.array(LinkSchema),
}

/** What `checkMap`/`linkEndProblem` need — shared structurally by the frozen v2 map (`kind`: 3-way) and the
 * current v3 Hexagonal map (`kind`: literal `'hexagonal'`), so one rule set serves both without duplicating it. */
interface MapLike {
  kind: string
  contexts: Context[]
  hexagons: Hexagon[]
  links: Link[]
}

/** Why an end cannot stand: unknown hexagon, unknown port, wrong side for its role, adapter missing or not on that port. */
export function linkEndProblem(map: MapLike, end: LinkEnd, role: 'from' | 'to'): string | undefined {
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

function checkMap(m: MapLike, ctx: z.RefinementCtx) {
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

// Frozen: the map format a v2 build wrote and still reads (any of the 3 kinds). Never change this schema — REQ-06
// coerces its `kind` back to hexagonal on open (hexa.ts), it does not touch what a v2 file is allowed to contain.
const MapObjectV2 = z.object({ version: z.literal(2), kind: KindSchema, ...MapFields })
export const HexaFileV2Schema = MapObjectV2.extend({ app: z.literal(APP) }).superRefine(checkMap)

// Frozen (v3): the Hexagonal arm a v3 build wrote (native-onion's own "current" before this change froze it,
// ADR-03) — never change this schema, a data-bearing addition belongs on the v4 map instead.
const HexagonalObjectV3 = z.object({ version: z.literal(3), kind: z.literal('hexagonal'), ...MapFields })
export const HexagonalFileV3Schema = HexagonalObjectV3.superRefine(checkMap)

// Current (v4): the Hexagonal arm of `StoredFile`. Same shape as v3's map — only the version literal moves, and
// `kind` narrows to `'hexagonal'` only: Onion and Clean are wholly separate document shapes below, never a
// `kind` of this one (ADR-01). A document-root union is what keeps every existing Hexagonal-only consumer
// (`model/map.ts`, `layout/map.ts`, `App.tsx`'s old render path) untouched — they read `HexaMap`, never `StoredFile`.
const HexagonalObjectV4 = z.object({ version: z.literal(VERSION), kind: z.literal('hexagonal'), ...MapFields })
export const HexagonalFileV4Schema = HexagonalObjectV4.superRefine(checkMap)
/** Alias kept for the many call sites (`model/store.ts`'s validate-by-reparse, tests) that already know this
 * name as "the current map's schema" — it always means the live `HexaMap` shape, whichever version that is. */
export const MapSchema = HexagonalFileV4Schema
export type HexaMap = z.infer<typeof HexagonalFileV4Schema>
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

// --- Onion: a wholly separate document shape (ADR-01) — flat, no hexagons/ports/adapters, always one diagram. ---

export const OnionRingRoleSchema = z.enum(['domain', 'domainServices', 'application', 'outer'])
const OnionRingSchema = z.object({ role: OnionRingRoleSchema, name: z.string() })
const OnionElementSchema = z.object({ id, name: z.string(), ringRole: OnionRingRoleSchema, note })
const OnionDependencySchema = z.object({ id, fromId: id, toId: id })
const OnionEndpointSchema = z.object({ id, name: z.string(), targetId: id.optional(), note })

export type OnionRingRole = z.infer<typeof OnionRingRoleSchema>
export type OnionElement = z.infer<typeof OnionElementSchema>
export type OnionDependency = z.infer<typeof OnionDependencySchema>
export type OnionEndpoint = z.infer<typeof OnionEndpointSchema>

const OnionFields = {
  title: z.string(),
  // Innermost-first, fixed at creation (REQ-02) — never grown, reordered or re-typed after a file exists.
  rings: z.tuple([OnionRingSchema, OnionRingSchema, OnionRingSchema, OnionRingSchema]),
  elements: z.array(OnionElementSchema),
  dependencies: z.array(OnionDependencySchema),
  actors: z.array(OnionEndpointSchema),
  externals: z.array(OnionEndpointSchema),
}

// Frozen (v3): the Onion arm a v3 build wrote — never change this schema, ADR-03.
const OnionFileObjectV3 = z.object({ version: z.literal(3), kind: z.literal('onion'), ...OnionFields })

const OnionFileObject = z.object({ version: z.literal(VERSION), kind: z.literal('onion'), ...OnionFields })

/** Shared by Onion and Clean (ADR-01): the duplicate-id check, the inward-dependency rule and the outer-ring
 * endpoint rule — the only difference between the two kinds is how an element's ring role is looked up (Onion:
 * `element.ringRole` directly; Clean: through its sector, ADR-02), so callers pass that lookup as `ringRoleOf`,
 * the same indirection RingedSections.tsx/RingedNodes.tsx already take as a prop. `idCollections` varies too —
 * Clean's includes `sectors`, Onion's doesn't — so it stays a caller-supplied list rather than a fixed key set. */
function checkRingedIntegrity(
  d: { rings: readonly { role: string }[]; elements: readonly { id: string }[]; dependencies: readonly { id: string; fromId: string; toId: string }[]; actors: readonly { id: string; targetId?: string }[]; externals: readonly { id: string; targetId?: string }[] },
  idCollections: readonly (readonly [string, readonly { id: string }[]])[],
  ringRoleOf: (elementId: string) => string | undefined,
  ctx: z.RefinementCtx,
) {
  for (const [key, items] of idCollections) {
    const seen = new Set<string>()
    items.forEach((item, i) => {
      if (seen.has(item.id)) ctx.addIssue({ code: 'custom', message: `Duplicate id "${item.id}"`, path: [key, i, 'id'] })
      seen.add(item.id)
    })
  }
  const elementById = new Map(d.elements.map((e) => [e.id, e]))
  const outerRole = outerRoleOf(d.rings)
  // Inward-dependency rule: a dependency may only point to the same ring or a more inward one.
  d.dependencies.forEach((dep, i) => {
    const from = elementById.get(dep.fromId)
    const to = elementById.get(dep.toId)
    if (!from) ctx.addIssue({ code: 'custom', message: `Unknown element id "${dep.fromId}"`, path: ['dependencies', i, 'fromId'] })
    if (!to) ctx.addIssue({ code: 'custom', message: `Unknown element id "${dep.toId}"`, path: ['dependencies', i, 'toId'] })
    const fromRole = from && ringRoleOf(dep.fromId)
    const toRole = to && ringRoleOf(dep.toId)
    if (fromRole && toRole && !isInwardOrSame(d.rings, fromRole, toRole)) {
      ctx.addIssue({ code: 'custom', message: 'A dependency cannot point to a more outward ring', path: ['dependencies', i, 'toId'] })
    }
  })
  // Outer-ring endpoint rule: an actor/external may only target an outer-ring element.
  for (const key of ['actors', 'externals'] as const) {
    d[key].forEach((endpoint, i) => {
      if (endpoint.targetId === undefined) return
      const target = elementById.get(endpoint.targetId)
      if (!target) {
        ctx.addIssue({ code: 'custom', message: `Unknown element id "${endpoint.targetId}"`, path: [key, i, 'targetId'] })
      } else if (ringRoleOf(endpoint.targetId) !== outerRole) {
        ctx.addIssue({ code: 'custom', message: 'An actor or external system can only target an outer-ring element', path: [key, i, 'targetId'] })
      }
    })
  }
}

function checkOnionIntegrity(
  d: Pick<z.infer<typeof OnionFileObject>, 'rings' | 'elements' | 'dependencies' | 'actors' | 'externals'>,
  ctx: z.RefinementCtx,
) {
  const idCollections = [
    ['elements', d.elements],
    ['dependencies', d.dependencies],
    ['actors', d.actors],
    ['externals', d.externals],
  ] as const
  const elementById = new Map(d.elements.map((e) => [e.id, e]))
  checkRingedIntegrity(d, idCollections, (elementId) => elementById.get(elementId)?.ringRole, ctx)
}

export const OnionFileSchema = OnionFileObject.superRefine(checkOnionIntegrity)
export type OnionFile = z.infer<typeof OnionFileSchema>

// --- Clean: a 3rd document shape (ADR-01) — same flat, always-one-diagram shape as Onion, but every element
// belongs to a free, user-named sector, never directly to a ring (ADR-02: sector owns the ring role). ---

export const CleanRingRoleSchema = z.enum(['domain', 'application', 'adapters', 'outer'])
const CleanRingSchema = z.object({ role: CleanRingRoleSchema, name: z.string() })
const CleanSectorSchema = z.object({ id, name: z.string(), ringRole: CleanRingRoleSchema })
const CleanElementSchema = z.object({ id, name: z.string(), sectorId: id, note })
const CleanDependencySchema = z.object({ id, fromId: id, toId: id })
const CleanEndpointSchema = z.object({ id, name: z.string(), targetId: id.optional(), note })

export type CleanRingRole = z.infer<typeof CleanRingRoleSchema>
export type CleanSector = z.infer<typeof CleanSectorSchema>
export type CleanElement = z.infer<typeof CleanElementSchema>
export type CleanDependency = z.infer<typeof CleanDependencySchema>
export type CleanEndpoint = z.infer<typeof CleanEndpointSchema>

const CleanFileObject = z.object({
  version: z.literal(VERSION),
  kind: z.literal('clean'),
  title: z.string(),
  // Innermost-first, fixed at creation (REQ-02) — never grown, reordered or re-typed after a file exists.
  rings: z.tuple([CleanRingSchema, CleanRingSchema, CleanRingSchema, CleanRingSchema]),
  // Free — the user creates and names them inside any ring (REQ-03); 0..N per ring, including 0.
  sectors: z.array(CleanSectorSchema),
  elements: z.array(CleanElementSchema),
  dependencies: z.array(CleanDependencySchema),
  actors: z.array(CleanEndpointSchema),
  externals: z.array(CleanEndpointSchema),
})

function checkCleanIntegrity(
  d: Pick<z.infer<typeof CleanFileObject>, 'rings' | 'sectors' | 'elements' | 'dependencies' | 'actors' | 'externals'>,
  ctx: z.RefinementCtx,
) {
  const idCollections = [
    ['sectors', d.sectors],
    ['elements', d.elements],
    ['dependencies', d.dependencies],
    ['actors', d.actors],
    ['externals', d.externals],
  ] as const
  const sectorById = new Map(d.sectors.map((s) => [s.id, s]))
  // Every element must name a real sector (REQ-04: no ring-direct placement exists) — its ring role is always
  // resolved through the sector, never stored on the element itself (ADR-02). Genuinely Clean-specific: Onion
  // elements carry their ring role directly and have nothing to validate here.
  d.elements.forEach((e, i) => {
    if (!sectorById.has(e.sectorId)) ctx.addIssue({ code: 'custom', message: `Unknown sector id "${e.sectorId}"`, path: ['elements', i, 'sectorId'] })
  })
  const elementById = new Map(d.elements.map((e) => [e.id, e]))
  const ringRoleOf = (elementId: string) => sectorById.get(elementById.get(elementId)?.sectorId ?? '')?.ringRole
  checkRingedIntegrity(d, idCollections, ringRoleOf, ctx)
}

export const CleanFileSchema = CleanFileObject.superRefine(checkCleanIntegrity)
export type CleanFile = z.infer<typeof CleanFileSchema>

// --- StoredFile: the document-root union — the ONLY place Hexagonal, Onion and Clean meet (ADR-01). ---

export type StoredFile = HexaMap | OnionFile | CleanFile
// The on-disk/share-link shape (`app` wrapper), same convention as HexaFileV1Schema/HexaFileV2Schema — kept
// separate from HexagonalFileV4Schema/OnionFileSchema/CleanFileSchema (app-less, the in-memory `StoredFile`
// shape) because a refined object can't be `.extend()`-ed (see the v1 comment above).

// Frozen (v3): the 2-way (Hexagonal|Onion) shape a v3 build wrote — Clean did not exist yet (ADR-03). Only
// parseHexa's version===3 branch reads this, to upgrade a v3 file to the current version on open.
export const HexaFileV3Schema = z.discriminatedUnion('kind', [
  HexagonalObjectV3.extend({ app: z.literal(APP) }).superRefine(checkMap),
  OnionFileObjectV3.extend({ app: z.literal(APP) }).superRefine(checkOnionIntegrity),
])

// Current (v4): the 3-way union — Hexagonal, Onion, and Clean.
export const HexaFileV4Schema = z.discriminatedUnion('kind', [
  HexagonalObjectV4.extend({ app: z.literal(APP) }).superRefine(checkMap),
  OnionFileObject.extend({ app: z.literal(APP) }).superRefine(checkOnionIntegrity),
  CleanFileObject.extend({ app: z.literal(APP) }).superRefine(checkCleanIntegrity),
])
