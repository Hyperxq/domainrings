import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { parseHexa } from './model/hexa'
import { decodeSharePayload, SHARE_HASH_PREFIX } from './ui/shareLink'
import { installCompressionStreamPolyfill } from './test/fixtures'

// The published CLI cannot import the app's parser, so these tests pin its output to the app's decoder, and its
// accepted kinds to the app's example files.
const BIN = resolve(__dirname, '../cli/bin/domainrings.mjs')
const examples = import.meta.glob('./examples/*.hexa', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const honeycomb = resolve(__dirname, '../skills/domainrings/references/honeycomb.hexa')

beforeEach(installCompressionStreamPolyfill)

const cli = (...args: string[]) => spawnSync('node', [BIN, ...args], { encoding: 'utf8' })
const link = (file: string, ...args: string[]) => cli('link', file, ...args)

const optionsOf = (url: string) => {
  const [payload, ...options] = url.trim().slice(url.indexOf(SHARE_HASH_PREFIX) + SHARE_HASH_PREFIX.length).split('&')
  return { payload, options: new URLSearchParams(options.join('&')) }
}

describe('domainrings link', () => {
  it.each(Object.keys(examples))('prints a link for %s that the app decodes back to the same map', async (path) => {
    const run = link(resolve(__dirname, path))
    expect(run.status).toBe(0)
    expect(run.stdout.trim().startsWith(`https://diagrams.pbuilder.dev/${SHARE_HASH_PREFIX}`)).toBe(true)
    const decoded = parseHexa((await decodeSharePayload(optionsOf(run.stdout).payload))!)
    const original = parseHexa(examples[path])
    expect(original.ok).toBe(true)
    expect(decoded.ok && original.ok && decoded.map).toEqual(original.ok && original.map)
  })

  it('covers every kind the app opens', () => {
    expect([...new Set(Object.values(examples).map((t) => JSON.parse(t).kind))].sort()).toEqual(['clean', 'hexagonal', 'onion'])
  })

  it('adds the flow and its hexagon for a use case id, and still decodes to the same map', async () => {
    const run = link(honeycomb, '--flow', 'uc-charge')
    expect(run.status).toBe(0)
    const { payload, options } = optionsOf(run.stdout)
    expect(options.get('flow')).toBe('uc-charge')
    expect(options.get('hex')).toBe('h2')
    expect(parseHexa((await decodeSharePayload(payload))!).ok).toBe(true)
  })

  it('resolves a use case name to its id', () => {
    const { options } = optionsOf(link(honeycomb, '--flow', 'PlaceOrder').stdout)
    expect(options.get('flow')).toBe('uc-place')
    expect(options.get('hex')).toBe('h1')
  })

  it('narrows an ambiguous flow with --hex', () => {
    const file = tempHexa({
      app: 'domainrings', version: 5, kind: 'hexagonal', title: 'Two',
      contexts: [{ id: 'c1' }],
      hexagons: ['a', 'b'].map((id, q) => ({ id, contextId: 'c1', cell: { q, r: 0 }, title: id.toUpperCase(), domain: [], useCases: [{ id: 'go', name: 'Go' }], ports: [], adapters: [], actors: [], externals: [] })),
      links: [],
    })
    const ambiguous = link(file, '--flow', 'go')
    expect(ambiguous.status).not.toBe(0)
    expect(ambiguous.stdout).toBe('')
    expect(ambiguous.stderr).toMatch(/A.*B/s)
    expect(optionsOf(link(file, '--flow', 'go', '--hex', 'b').stdout).options.get('hex')).toBe('b')
  })

  it('fails on an unknown flow, listing the available ones', () => {
    const run = link(honeycomb, '--flow', 'nope')
    expect(run.status).not.toBe(0)
    expect(run.stdout).toBe('')
    expect(run.stderr).toMatch(/PlaceOrder/)
  })

  it('refuses flow options on a map that is not hexagonal', () => {
    const onion = Object.entries(examples).find(([, t]) => JSON.parse(t).kind === 'onion')![0]
    const run = link(resolve(__dirname, onion), '--flow', 'x')
    expect(run.status).not.toBe(0)
    expect(run.stderr).toMatch(/hexagonal/)
  })

  it('honours --base-url', () => {
    const run = link(honeycomb, '--base-url', 'http://localhost:5179/')
    expect(run.stdout.startsWith('http://localhost:5179/#m=')).toBe(true)
  })

  it('refuses a file that is not a domainrings map', () => {
    const run = link(tempHexa({ app: 'other', version: 2 }))
    expect(run.status).not.toBe(0)
    expect(run.stdout).toBe('')
    expect(run.stderr).toMatch(/domainrings/)
  })

  it('refuses an unknown command and a missing file', () => {
    expect(cli('frobnicate').status).not.toBe(0)
    expect(cli('link').status).not.toBe(0)
  })
})

function tempHexa(json: unknown): string {
  const file = join(mkdtempSync(join(tmpdir(), 'cli-')), 'map.hexa')
  writeFileSync(file, JSON.stringify(json))
  return file
}
