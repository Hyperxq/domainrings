import { APP, HexaFileV1Schema, HexaFileV2Schema, HexaFileV3Schema, VERSION, type HexaMap, type LegacyDiagram, type OnionFile, type StoredFile } from './schema'
import type { z } from 'zod'

export type HexaParseResult = { ok: true; map: StoredFile; v1?: LegacyDiagram } | { ok: false; reason: 'invalid' | 'newer'; errors: string[] }

export function toHexa(file: StoredFile): string {
  return JSON.stringify({ app: APP, ...file }, null, 2)
}

/** Deterministic: a migrated v1 file always becomes context "c1" holding hexagon "h1" at the origin cell. Always
 * hexagonal (REQ-06): a v1 file's own `kind` (Clean/Onion under the old switcher) is never carried forward. */
export function toMap(diagram: LegacyDiagram): HexaMap {
  const { version: _version, kind: _kind, title, ...hexagonFields } = diagram
  return {
    version: VERSION,
    kind: 'hexagonal',
    title,
    contexts: [{ id: 'c1' }],
    hexagons: [{ id: 'h1', contextId: 'c1', cell: { q: 0, r: 0 }, title, ...hexagonFields }],
    links: [],
  }
}

// Innermost-first (REQ-02) — fixed at creation, never grown/reordered/re-typed once a file exists.
const ONION_RINGS: OnionFile['rings'] = [
  { role: 'domain', name: 'Domain Model' },
  { role: 'domainServices', name: 'Domain Services' },
  { role: 'application', name: 'Application Services' },
  { role: 'outer', name: 'Infrastructure' },
]

/** A fresh Onion file: the 4 canonical rings, nothing in them yet (REQ-02). */
export function newOnionMap(title: string): OnionFile {
  return { version: VERSION, kind: 'onion', title, rings: ONION_RINGS, elements: [], dependencies: [], actors: [], externals: [] }
}

function issuesOf(error: z.ZodError, version: number): string[] {
  return error.issues.map((i) => `Version ${version} file: ${i.path.join('.') || '(file)'}: ${i.message}`)
}

export function parseHexa(text: string): HexaParseResult {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    return { ok: false, reason: 'invalid', errors: [`The file is not valid JSON (${(error as Error).message})`] }
  }
  const record = typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : {}
  if (record.app !== APP && record.app !== 'archviz') {
    return { ok: false, reason: 'invalid', errors: ['This is not a domainrings file.'] }
  }
  const version = record.version
  if (typeof version !== 'number') {
    return { ok: false, reason: 'invalid', errors: ['The file has no version number.'] }
  }
  if (version > VERSION) {
    return {
      ok: false,
      reason: 'newer',
      errors: [`This file was made by a newer version of domainrings (file version ${version}). This version opens versions 1 and ${VERSION}.`],
    }
  }
  if (version === 1) {
    const result = HexaFileV1Schema.safeParse(json)
    if (!result.success) return { ok: false, reason: 'invalid', errors: issuesOf(result.error, 1) }
    const { app: _app, ...diagram } = result.data
    return { ok: true, map: toMap(diagram), v1: diagram }
  }
  if (version === 2) {
    const result = HexaFileV2Schema.safeParse(json)
    if (!result.success) return { ok: false, reason: 'invalid', errors: issuesOf(result.error, 2) }
    // REQ-06: a v2 file's stored kind (any of the 3) never survives the open — only hexagonal ever renders live.
    // Upgraded to the current version on open, same as a v1 file migrating to v2 always did (toMap above).
    const { app: _app, version: _version, kind: _kind, ...map } = result.data
    return { ok: true, map: { ...map, version: VERSION, kind: 'hexagonal' } }
  }
  if (version === VERSION) {
    const result = HexaFileV3Schema.safeParse(json)
    if (!result.success) return { ok: false, reason: 'invalid', errors: issuesOf(result.error, VERSION) }
    const { app: _app, ...file } = result.data
    return { ok: true, map: file }
  }
  return { ok: false, reason: 'invalid', errors: [`Unknown file version "${version}"`] }
}
