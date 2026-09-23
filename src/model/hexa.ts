import { APP, HexaFileV1Schema, HexaFileV2Schema, VERSION, type Diagram, type HexaMap } from './schema'
import type { z } from 'zod'

export type HexaParseResult = { ok: true; map: HexaMap; v1?: Diagram } | { ok: false; reason: 'invalid' | 'newer'; errors: string[] }

export function toHexa(map: HexaMap): string {
  return JSON.stringify({ app: APP, ...map }, null, 2)
}

/** Deterministic: a migrated v1 file always becomes context "c1" holding hexagon "h1" at the origin cell. */
export function toMap(diagram: Diagram): HexaMap {
  const { version: _version, kind, title, ...hexagonFields } = diagram
  return {
    version: VERSION,
    kind,
    title,
    contexts: [{ id: 'c1' }],
    hexagons: [{ id: 'h1', contextId: 'c1', cell: { q: 0, r: 0 }, title, ...hexagonFields }],
    links: [],
  }
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
  if (version === VERSION) {
    const result = HexaFileV2Schema.safeParse(json)
    if (!result.success) return { ok: false, reason: 'invalid', errors: issuesOf(result.error, VERSION) }
    const { app: _app, ...map } = result.data
    return { ok: true, map }
  }
  return { ok: false, reason: 'invalid', errors: [`Unknown file version "${version}"`] }
}
