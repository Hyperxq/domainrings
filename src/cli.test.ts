import { execFile, spawnSync } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error the CLI is plain untyped ESM
import { PALETTE_IDS } from '../cli/src/render.mjs'
import { PALETTES } from './ui/palette'
import { parseHexa } from './model/hexa'
import { decodeSharePayload, fetchStoredPayload, SHARE_HASH_PREFIX, STORED_HASH_PREFIX } from './ui/shareLink'
import { installCompressionStreamPolyfill, memoryShareDb, SHARE_STORE_URL } from './test/fixtures'
import shareWorker from '../worker/src/index'

// The published CLI cannot import the app's parser, so these tests pin its output to the app's decoder, and its
// accepted kinds to the app's example files.
const BIN = resolve(__dirname, '../cli/bin/domainrings.mjs')
const examples = import.meta.glob('./examples/*.hexa', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const honeycomb = resolve(__dirname, '../skills/domainrings/references/honeycomb.hexa')

beforeEach(installCompressionStreamPolyfill)

const cli = (...args: string[]) => spawnSync('node', [BIN, ...args], { encoding: 'utf8' })
// --full keeps these runs off the network; the short-link tests below bring their own store.
const link = (file: string, ...args: string[]) => cli('link', file, '--full', ...args)
// Async, so the in-process store below can answer while the CLI waits.
const linkAsync = (...args: string[]) =>
  new Promise<{ code: number; stdout: string; stderr: string }>((done) => {
    execFile('node', [BIN, 'link', ...args], (error, stdout, stderr) => done({ code: error ? Number(error.code) : 0, stdout, stderr }))
  })

const optionsOf = (url: string) => {
  const [payload, ...options] = url.trim().slice(url.indexOf(SHARE_HASH_PREFIX) + SHARE_HASH_PREFIX.length).split('&')
  return { payload, options: new URLSearchParams(options.join('&')) }
}

describe('domainrings render options', () => {
  it('lists the palettes the app ships', () => {
    expect([...PALETTE_IDS].sort()).toEqual(Object.keys(PALETTES).sort())
  })
})

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

describe('domainrings link (short links)', () => {
  let server: Server | undefined
  afterEach(() => server?.close())

  // A real HTTP server in front of the real share Worker, so the CLI talks to it exactly as it talks to production.
  const startStore = (db = memoryShareDb(), status?: number) =>
    new Promise<string>((ready) => {
      server = createServer((request, response) => {
        let body = ''
        request.on('data', (chunk) => (body += chunk))
        request.on('end', async () => {
          if (status) return response.writeHead(status).end()
          const answer = await shareWorker.fetch(new Request(`${SHARE_STORE_URL}${request.url}`, { method: request.method, body: request.method === 'POST' ? body : undefined }), { DB: db })
          response.writeHead(answer.status, Object.fromEntries(answer.headers)).end(await answer.text())
        })
      }).listen(0, '127.0.0.1', () => ready(`http://127.0.0.1:${(server!.address() as { port: number }).port}`))
    })

  it('prints a #s= link, keeps the flow, and the app opens the stored map', async () => {
    const db = memoryShareDb()
    const run = await linkAsync(honeycomb, '--flow', 'uc-charge', '--store', await startStore(db))
    expect(run.code).toBe(0)
    expect(run.stderr).toBe('')
    const url = run.stdout.trim()
    expect(url.startsWith(`https://diagrams.pbuilder.dev/${STORED_HASH_PREFIX}`)).toBe(true)
    const [token, ...options] = url.slice(url.indexOf(STORED_HASH_PREFIX) + STORED_HASH_PREFIX.length).split('&')
    expect(new URLSearchParams(options.join('&')).get('flow')).toBe('uc-charge')
    expect(new URLSearchParams(options.join('&')).get('hex')).toBe('h2')
    vi.stubEnv('VITE_SHARE_API_URL', SHARE_STORE_URL)
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => shareWorker.fetch(new Request(input, init), { DB: db }))
    const stored = await fetchStoredPayload(token)
    expect('text' in stored).toBe(true)
    const decoded = parseHexa((stored as { text: string }).text)
    const original = parseHexa(readFileSync(honeycomb, 'utf8'))
    expect(decoded.ok && original.ok && decoded.map).toEqual(original.ok && original.map)
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it.each([429, 503])('falls back to the #m= link when the store answers %i, and says so', async (status) => {
    const run = await linkAsync(honeycomb, '--store', await startStore(undefined, status))
    expect(run.code).toBe(0)
    expect(run.stdout.startsWith(`https://diagrams.pbuilder.dev/${SHARE_HASH_PREFIX}`)).toBe(true)
    expect(run.stderr).toMatch(new RegExp(`${status}.*#m=`))
  })

  it('falls back when the store is down', async () => {
    const run = await linkAsync(honeycomb, '--store', 'http://127.0.0.1:1')
    expect(run.code).toBe(0)
    expect(run.stdout).toContain(SHARE_HASH_PREFIX)
    expect(run.stderr).toMatch(/Short link unavailable/)
  })

  it('prints the full link for another --base-url without a --store, and says how to get a short one', async () => {
    const run = await linkAsync(honeycomb, '--base-url', 'http://localhost:5179/')
    expect(run.stdout.startsWith('http://localhost:5179/#m=')).toBe(true)
    expect(run.stderr).toMatch(/--store/)
  })

  it('--full prints the #m= link without touching the store', async () => {
    let hits = 0
    const store = await startStore()
    server!.on('request', () => hits++)
    const run = await linkAsync(honeycomb, '--full', '--store', store)
    expect(run.stdout).toContain(SHARE_HASH_PREFIX)
    expect(run.stderr).toBe('')
    expect(hits).toBe(0)
  })
})

function tempHexa(json: unknown): string {
  const file = join(mkdtempSync(join(tmpdir(), 'cli-')), 'map.hexa')
  writeFileSync(file, JSON.stringify(json))
  return file
}
