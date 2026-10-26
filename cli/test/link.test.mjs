import { createServer } from 'node:http'
import { webcrypto } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { openerCommand, resolveFlow, shareLink, storedLink, storeMap } from '../src/link.mjs'

const hexagon = (id, title, useCases) => ({ id, title, useCases })
const map = {
  app: 'domainrings',
  version: 5,
  kind: 'hexagonal',
  title: 'Shop',
  hexagons: [
    hexagon('h1', 'Orders', [{ id: 'place', name: 'PlaceOrder' }, { id: 'cancel', name: 'Cancel' }]),
    hexagon('h2', 'Billing', [{ id: 'charge', name: 'ChargeOrder' }, { id: 'cancel', name: 'Cancel' }]),
  ],
}

describe('resolveFlow', () => {
  it('matches a use case id', () => {
    expect(resolveFlow(map, 'place')).toMatchObject({ hexagonId: 'h1', useCaseId: 'place', hexagonTitle: 'Orders', name: 'PlaceOrder' })
  })

  it('matches a use case name when no id matches', () => {
    expect(resolveFlow(map, 'ChargeOrder')).toMatchObject({ hexagonId: 'h2', useCaseId: 'charge' })
  })

  it('prefers an id over a name', () => {
    const tricky = { ...map, hexagons: [hexagon('h1', 'A', [{ id: 'x', name: 'y' }, { id: 'y', name: 'x' }])] }
    expect(resolveFlow(tricky, 'x').useCaseId).toBe('x')
  })

  it('fails on a flow found in several hexagons, listing them', () => {
    expect(() => resolveFlow(map, 'cancel')).toThrow(/Orders.*Billing/s)
  })

  it('disambiguates with a hexagon id', () => {
    expect(resolveFlow(map, 'cancel', 'h2')).toMatchObject({ hexagonId: 'h2', useCaseId: 'cancel' })
  })

  it('fails when the flow is not in the requested hexagon', () => {
    expect(() => resolveFlow(map, 'place', 'h2')).toThrow(/h2/)
  })

  it('fails on an unknown flow, listing the available ones', () => {
    expect(() => resolveFlow(map, 'nope')).toThrow(/PlaceOrder.*ChargeOrder/s)
  })

  it('refuses flow options on a map that is not hexagonal', () => {
    expect(() => resolveFlow({ app: 'domainrings', version: 5, kind: 'onion', title: 'O' }, 'x')).toThrow(/hexagonal/)
  })
})

describe('shareLink', () => {
  it('uses the default base address and no flow options', () => {
    expect(shareLink(map)).toMatch(/^https:\/\/diagrams\.pbuilder\.dev\/#m=[\w-]+$/)
  })

  it('normalises a custom base address and appends the flow and hexagon', () => {
    const link = shareLink(map, { baseUrl: 'http://localhost:5179', flow: { hexagonId: 'h 1', useCaseId: 'place' } })
    expect(link).toMatch(/^http:\/\/localhost:5179\/#m=[\w-]+&flow=place&hex=h%201$/)
  })

  it('rejects an address that is not a URL', () => {
    expect(() => shareLink(map, { baseUrl: 'not a url' })).toThrow(/--base-url/)
  })
})

describe('storedLink', () => {
  it('puts the token after #s= and keeps the flow options', () => {
    expect(storedLink('abc,key', { flow: { hexagonId: 'h 1', useCaseId: 'place' } })).toBe('https://diagrams.pbuilder.dev/#s=abc,key&flow=place&hex=h%201')
  })
})

describe('storeMap', () => {
  let server
  afterEach(() => server?.close())

  const store = (handler) =>
    new Promise((resolve) => {
      server = createServer(handler).listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}/`))
    })

  it('posts the encrypted map and returns the id with a key only the token holds', async () => {
    let body = ''
    const url = await store((request, response) => {
      request.on('data', (chunk) => (body += chunk))
      request.on('end', () => response.writeHead(201, { 'Content-Type': 'application/json' }).end('{"id":"abc_-1"}'))
    })
    const { token } = await storeMap(map, { store: url })
    const [id, key] = token.split(',')
    expect(id).toBe('abc_-1')
    expect(body).toMatch(/^[\w-]+$/)
    const sealed = Buffer.from(body, 'base64url')
    const cryptoKey = await webcrypto.subtle.importKey('raw', Buffer.from(key, 'base64url'), 'AES-GCM', false, ['decrypt'])
    const plain = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.subarray(0, 12) }, cryptoKey, sealed.subarray(12))
    expect(JSON.parse(inflateRawSync(Buffer.from(plain)).toString())).toEqual(map)
  })

  it.each([429, 503, 413])('reports a store that answers %i', async (status) => {
    const url = await store((_, response) => response.writeHead(status).end())
    expect(await storeMap(map, { store: url })).toEqual({ failure: expect.stringContaining(String(status)) })
  })

  it('reports an id it cannot put in a link', async () => {
    const url = await store((_, response) => response.writeHead(201).end('{"id":"a/b"}'))
    expect(await storeMap(map, { store: url })).toHaveProperty('failure')
  })

  it('gives up on a store that does not answer in time', async () => {
    const url = await store(() => {})
    expect(await storeMap(map, { store: url, timeoutMs: 50 })).toEqual({ failure: expect.stringMatching(/5?0 ?ms|time/) })
  })

  it('reports a store it cannot reach', async () => {
    expect(await storeMap(map, { store: 'http://127.0.0.1:1/' })).toHaveProperty('failure')
  })
})

describe('openerCommand', () => {
  it.each([
    ['darwin', 'open', ['https://x/']],
    ['linux', 'xdg-open', ['https://x/']],
    ['win32', 'rundll32', ['url.dll,FileProtocolHandler', 'https://x/']],
  ])('picks the %s opener', (platform, command, args) => {
    expect(openerCommand(platform, 'https://x/')).toEqual({ command, args })
  })

  it('passes a url with & to the Windows opener untouched, since it does not go through cmd', () => {
    const url = 'https://x/#m=abc&flow=a&hex=b'
    expect(openerCommand('win32', url).args.at(-1)).toBe(url)
  })
})
