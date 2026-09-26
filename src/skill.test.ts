import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseHexa } from './model/hexa'
import { decodeSharePayload, SHARE_HASH_PREFIX, SHARE_LINK_MAX_CHARS } from './ui/shareLink'
import { installCompressionStreamPolyfill } from './test/fixtures'

// The published skill is copied out of this repo on install, so it carries its own examples and script. These
// tests keep both honest against the app: every example must open, and every link the script prints must load.
const SKILL = resolve(__dirname, '../skills/domainrings-hexagonal')
const SCRIPT = join(SKILL, 'scripts/share-link.mjs')
const examples = import.meta.glob('../skills/domainrings-hexagonal/references/*.hexa', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

beforeEach(installCompressionStreamPolyfill)
afterEach(() => vi.unstubAllGlobals())

const shareLink = (file: string) => spawnSync('node', [SCRIPT, file], { encoding: 'utf8' })

function tempHexa(json: unknown): string {
  const file = join(mkdtempSync(join(tmpdir(), 'skill-')), 'map.hexa')
  writeFileSync(file, JSON.stringify(json))
  return file
}

describe('skill examples', () => {
  it('ships a single-hexagon example and a honeycomb example', () => {
    expect(Object.keys(examples).map((p) => p.split('/').pop()).sort()).toEqual(['honeycomb.hexa', 'single-hexagon.hexa'])
  })

  it.each(Object.entries(examples))('%s opens in the app', (_path, text) => {
    const result = parseHexa(text)
    expect(result.ok ? [] : result.errors).toEqual([])
  })

  it('the honeycomb example shows what a honeycomb adds: several contexts and a patterned cross-context link', () => {
    const result = parseHexa(Object.entries(examples).find(([p]) => p.endsWith('honeycomb.hexa'))![1])
    if (!result.ok) throw new Error('honeycomb example failed to parse')
    expect(result.map.contexts.length).toBeGreaterThan(1)
    expect(result.map.links.some((l) => l.pattern !== undefined)).toBe(true)
    expect(result.map.links.some((l) => l.pattern === undefined)).toBe(true)
  })
})

describe('share-link script', () => {
  it.each(Object.keys(examples))('prints a link for %s that the app decodes back to the same map', async (path) => {
    const run = shareLink(resolve(__dirname, path))
    expect(run.status).toBe(0)

    const link = run.stdout.trim()
    expect(link.startsWith(`https://diagrams.pbuilder.dev/${SHARE_HASH_PREFIX}`)).toBe(true)
    const text = await decodeSharePayload(link.slice(link.indexOf(SHARE_HASH_PREFIX) + SHARE_HASH_PREFIX.length))
    const decoded = parseHexa(text!)
    const original = parseHexa(examples[path])
    expect(decoded.ok && original.ok && decoded.map).toEqual(original.ok && original.map)
  })

  it('refuses a file that is not a domainrings v2 map', () => {
    const run = shareLink(tempHexa({ app: 'something-else', version: 2 }))
    expect(run.status).not.toBe(0)
    expect(run.stdout).toBe('')
    expect(run.stderr).toMatch(/domainrings/)
  })

  it(`warns when the link is longer than the app's ${SHARE_LINK_MAX_CHARS}-character budget`, () => {
    const ports = Array.from({ length: 800 }, (_, i) => ({ id: `p-${i}-${Math.random().toString(36).slice(2)}`, name: `Port${i}`, side: 'driven' }))
    const run = shareLink(tempHexa({ app: 'domainrings', version: 2, kind: 'hexagonal', title: 'Big', contexts: [{ id: 'c1' }], hexagons: [{ id: 'h1', contextId: 'c1', cell: { q: 0, r: 0 }, title: 'Big', domain: [], useCases: [], ports, adapters: [], actors: [], externals: [] }], links: [] }))
    expect(run.status).toBe(0)
    expect(run.stdout.trim().length).toBeGreaterThan(SHARE_LINK_MAX_CHARS)
    expect(run.stderr).toContain(String(SHARE_LINK_MAX_CHARS))
  })
})
