import { describe, expect, it } from 'vitest'
import worker, { MAX_SHARE_CHARS } from './index'
import { memoryShareDb } from '../../src/test/fixtures'

const STORE = 'https://share.example.test'
const post = (body: string, env: Parameters<typeof worker.fetch>[1]) => worker.fetch(new Request(`${STORE}/`, { method: 'POST', body }), env)

describe('share store Worker', () => {
  it('stores a base64url payload under a new id and serves it back as immutable', async () => {
    const db = memoryShareDb()

    const created = await post('c2VhbGVk-_', { DB: db })
    const { id } = (await created.json()) as { id: string }
    const read = await worker.fetch(new Request(`${STORE}/${id}`), { DB: db })

    expect(created.status).toBe(201)
    expect(id).toMatch(/^[A-Za-z0-9_-]{11}$/)
    expect(db.rows.get(id)).toBe('c2VhbGVk-_')
    expect(read.status).toBe(200)
    expect(await read.text()).toBe('c2VhbGVk-_')
    expect(read.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
    expect(read.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('answers an unknown id with an uncached 404', async () => {
    const read = await worker.fetch(new Request(`${STORE}/AAAAAAAAAAA`), { DB: memoryShareDb() })

    expect(read.status).toBe(404)
    expect(read.headers.get('Cache-Control')).toBe('no-store')
  })

  it('rejects an oversized, empty or non-base64url payload without storing it', async () => {
    const db = memoryShareDb()

    expect((await post('a'.repeat(MAX_SHARE_CHARS + 1), { DB: db })).status).toBe(413)
    expect((await post('', { DB: db })).status).toBe(413)
    expect((await post('{"title":"plain"}', { DB: db })).status).toBe(400)
    expect(db.rows.size).toBe(0)
  })

  it('answers 503 when the database refuses the write (free-plan quota reached)', async () => {
    const failing = { prepare: () => ({ bind: () => ({ run: () => Promise.reject(new Error('D1_ERROR: limit')), first: async () => null }) }) }

    expect((await post('abc', { DB: failing })).status).toBe(503)
  })

  it('answers 429 once the per-client rate limit is spent', async () => {
    const db = memoryShareDb()
    const limiter = { limit: async () => ({ success: false }) }

    expect((await post('abc', { DB: db, SHARE_LIMITER: limiter })).status).toBe(429)
    expect(db.rows.size).toBe(0)
  })

  it('answers the CORS preflight', async () => {
    const preflight = await worker.fetch(new Request(`${STORE}/`, { method: 'OPTIONS' }), { DB: memoryShareDb() })

    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST')
  })
})
