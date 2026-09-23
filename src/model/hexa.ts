import { APP, HexaFileSchema, type Diagram } from './schema'

export type HexaParseResult = { ok: true; diagram: Diagram } | { ok: false; errors: string[] }

export function toHexa(diagram: Diagram): string {
  return JSON.stringify({ app: APP, ...diagram }, null, 2)
}

export function parseHexa(text: string): HexaParseResult {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    return { ok: false, errors: [`The file is not valid JSON (${(error as Error).message})`] }
  }
  const result = HexaFileSchema.safeParse(json)
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map((i) => `${i.path.join('.') || '(file)'}: ${i.message}`),
    }
  }
  const { app: _app, ...diagram } = result.data
  return { ok: true, diagram }
}
