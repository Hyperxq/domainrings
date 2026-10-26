import { webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { deflateRawSync } from 'node:zlib'

export const DEFAULT_BASE_URL = 'https://diagrams.pbuilder.dev/'
export const DEFAULT_STORE_URL = 'https://share.pbuilder.dev'
export const MAX_CHARS = 8000
// Same budget as the app's Copy link (src/ui/shareLink.ts): past it the self-contained link is used.
const UPLOAD_TIMEOUT_MS = 5000
const IV_BYTES = 12

const KINDS = ['hexagonal', 'onion', 'clean']

export function readMap(file) {
  let map
  try {
    map = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`Could not read ${file} as JSON: ${error.message}`)
  }
  // Mirrors the app's accepted versions and kinds; src/cli.test.ts fails if the app opens a kind this rejects.
  // v2 predates the kind split and is always hexagonal.
  const supported = map?.version === 2 || ([3, 4, 5].includes(map?.version) && KINDS.includes(map?.kind))
  if (map?.app !== 'domainrings' || !supported) {
    throw new Error(`Not a domainrings map: expected "app": "domainrings" and "version": 2, or "version": 3, 4 or 5 with "kind" one of ${KINDS.map((k) => `"${k}"`).join(', ')}.`)
  }
  return map
}

export const isHexagonal = (map) => map.version === 2 || map.kind === 'hexagonal'

export function flowsOf(map) {
  return (map.hexagons ?? []).flatMap((h) => (h.useCases ?? []).map((u) => ({ hexagonId: h.id, hexagonTitle: h.title, useCaseId: u.id, name: u.name })))
}

/** Use case ids are unique per hexagon only, so an id or name can match in several hexagons. */
export function resolveFlow(map, flow, hexagonId) {
  if (!isHexagonal(map)) throw new Error('--flow and --hex only apply to hexagonal maps.')
  const all = flowsOf(map)
  const inScope = hexagonId === undefined ? all : all.filter((f) => f.hexagonId === hexagonId)
  const byId = inScope.filter((f) => f.useCaseId === flow)
  const matches = byId.length > 0 ? byId : inScope.filter((f) => f.name === flow)
  if (matches.length === 1) return matches[0]
  const describe = (f) => `  ${f.name} (${f.useCaseId}) in ${f.hexagonTitle} [${f.hexagonId}]`
  if (matches.length > 1) throw new Error(`"${flow}" matches several flows; narrow it with --hex <hexagonId>:\n${matches.map(describe).join('\n')}`)
  const scope = hexagonId === undefined ? '' : ` in hexagon "${hexagonId}"`
  throw new Error(`No flow "${flow}"${scope}. Available flows:\n${inScope.map(describe).join('\n') || '  (none)'}`)
}

function linkTo(baseUrl, hash, flow, frame) {
  let base
  try {
    base = new URL(baseUrl)
  } catch {
    throw new Error(`--base-url is not a valid URL: ${baseUrl}`)
  }
  base.hash = ''
  const options = flow ? `&flow=${encodeURIComponent(flow.useCaseId)}&hex=${encodeURIComponent(flow.hexagonId)}${frame ? '&frame=flow' : ''}` : ''
  return `${base.href}${hash}${options}`
}

export function shareLink(map, { baseUrl = DEFAULT_BASE_URL, flow, frame = false } = {}) {
  return linkTo(baseUrl, `#m=${deflateRawSync(JSON.stringify(map)).toString('base64url')}`, flow, frame)
}

export function storedLink(token, { baseUrl = DEFAULT_BASE_URL, flow } = {}) {
  return linkTo(baseUrl, `#s=${token}`, flow, false)
}

/** Mirrors the app's storeSharePayload, which this published package cannot import; src/cli.test.ts pins the two
 * together by opening a CLI-stored map with the app's fetchStoredPayload. The key never leaves the token. */
export async function storeMap(map, { store, timeoutMs = UPLOAD_TIMEOUT_MS }) {
  try {
    const key = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 128 }, true, ['encrypt'])
    const iv = webcrypto.getRandomValues(new Uint8Array(IV_BYTES))
    const cipher = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, deflateRawSync(JSON.stringify(map)))
    const sealed = Buffer.concat([iv, new Uint8Array(cipher)])
    const response = await fetch(`${store.replace(/\/+$/, '')}/`, { method: 'POST', body: sealed.toString('base64url'), signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) return { failure: `the share store answered ${response.status}` }
    const { id } = await response.json()
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) return { failure: 'the share store answered without a usable id' }
    return { token: `${id},${Buffer.from(await webcrypto.subtle.exportKey('raw', key)).toString('base64url')}` }
  } catch (error) {
    if (error?.name === 'TimeoutError') return { failure: `the share store did not answer within ${timeoutMs} ms` }
    return { failure: `could not reach the share store (${error?.cause?.code ?? error?.message})` }
  }
}

// Windows: `cmd /c start` would split the url at `&`; rundll32 takes it as one argument.
export function openerCommand(platform, url) {
  if (platform === 'darwin') return { command: 'open', args: [url] }
  if (platform === 'win32') return { command: 'rundll32', args: ['url.dll,FileProtocolHandler', url] }
  return { command: 'xdg-open', args: [url] }
}
