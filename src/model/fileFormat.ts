import { z } from 'zod'
import {
  APP,
  checkCleanIntegrity,
  checkIntegrity,
  checkMap,
  checkOnionIntegrity,
  CleanFileFields,
  CleanFileObject,
  DiagramFields,
  HexagonalObjectV5,
  KindSchema,
  MapFields,
  OnionElementV3Schema,
  OnionElementV4Schema,
  OnionFileObject,
  OnionRingRoleSchema,
  OnionSharedFields,
  type CleanFile,
  type HexaMap,
  type OnionFile,
} from './schema'

// Files saved before the rename still open; parseHexa drops the marker, so they re-export under the current name.
// Frozen: the file format a v1 build wrote and still reads — including a Clean/Onion `kind` from the old kind
// switcher (REQ-06 coerces it back to hexagonal in parseHexa, it does not touch what a v1 file is allowed to
// contain). Never change this schema.
const LegacyDiagramObject = z.object({ version: z.literal(1), kind: KindSchema, ...DiagramFields })
export const HexaFileV1Schema = LegacyDiagramObject.extend({ app: z.enum([APP, 'archviz']) }).superRefine(checkIntegrity)

/** The wider, as-stored shape a v1 file may carry (any of the 3 legacy kinds) — kept distinct from the live
 * `Diagram` type (kind narrowed to 'hexagonal') so a genuinely non-hexagonal legacy file still parses. */
export type LegacyDiagram = z.infer<typeof LegacyDiagramObject>

// Frozen: the map format a v2 build wrote and still reads (any of the 3 kinds). Never change this schema — REQ-06
// coerces its `kind` back to hexagonal on open (hexa.ts), it does not touch what a v2 file is allowed to contain.
const MapObjectV2 = z.object({ version: z.literal(2), kind: KindSchema, ...MapFields })
export const HexaFileV2Schema = MapObjectV2.extend({ app: z.literal(APP) }).superRefine(checkMap)

// Frozen (v3): the Hexagonal arm a v3 build wrote (native-onion's own "current" before this change froze it,
// ADR-03) — never change this schema.
const HexagonalObjectV3 = z.object({ version: z.literal(3), kind: z.literal('hexagonal'), ...MapFields })
export const HexagonalFileV3Schema = HexagonalObjectV3.superRefine(checkMap)

// Frozen (v4): the Hexagonal arm a v4 build wrote — never change this schema.
const HexagonalObjectV4 = z.object({ version: z.literal(4), kind: z.literal('hexagonal'), ...MapFields })

const OnionRingSchemaV4 = z.object({ role: OnionRingRoleSchema, name: z.string() })
// Innermost-first, fixed at creation (REQ-02) — never grown, reordered or re-typed after a v3/v4 file exists.
const OnionRingsV4 = z.tuple([OnionRingSchemaV4, OnionRingSchemaV4, OnionRingSchemaV4, OnionRingSchemaV4])

// Frozen (v3): the Onion arm a v3 build wrote — never change this schema, ADR-03.
const OnionFileObjectV3 = z.object({ version: z.literal(3), kind: z.literal('onion'), ...OnionSharedFields, rings: OnionRingsV4, elements: z.array(OnionElementV3Schema) })
// Frozen (v4): the fixed 4-ring Onion arm a v4 build wrote — never change this schema, ADR-03.
const OnionFileObjectV4 = z.object({ version: z.literal(4), kind: z.literal('onion'), ...OnionSharedFields, rings: OnionRingsV4, elements: z.array(OnionElementV4Schema) })

// Frozen (v4): the Clean arm a v4 build wrote — Clean's shape did not change in v5, only the version literal moves.
const CleanFileObjectV4 = z.object({ version: z.literal(4), ...CleanFileFields })

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

// Frozen (v4): the 3-way union a v4 build wrote (fixed 4-ring Onion) — only parseHexa's version===4 branch reads
// this, to upgrade a v4 file to the current version on open.
export const HexaFileV4Schema = z.discriminatedUnion('kind', [
  HexagonalObjectV4.extend({ app: z.literal(APP) }).superRefine(checkMap),
  OnionFileObjectV4.extend({ app: z.literal(APP) }).superRefine(checkOnionIntegrity),
  CleanFileObjectV4.extend({ app: z.literal(APP) }).superRefine(checkCleanIntegrity),
])

// Current (v5): the 3-way union — Hexagonal, Onion (variable-length rings), and Clean.
export const HexaFileV5Schema = z.discriminatedUnion('kind', [
  HexagonalObjectV5.extend({ app: z.literal(APP) }).superRefine(checkMap),
  OnionFileObject.extend({ app: z.literal(APP) }).superRefine(checkOnionIntegrity),
  CleanFileObject.extend({ app: z.literal(APP) }).superRefine(checkCleanIntegrity),
])
