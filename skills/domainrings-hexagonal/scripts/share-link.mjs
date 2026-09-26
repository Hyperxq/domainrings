#!/usr/bin/env node
// Usage: node share-link.mjs <map.hexa>
// Prints a https://diagrams.pbuilder.dev link that opens the map. Same encoding as the app's "Copy link":
// deflate-raw over the .hexa JSON text, then base64url, after "#m=".
import { readFileSync } from 'node:fs'
import { deflateRawSync } from 'node:zlib'

const APP_URL = 'https://diagrams.pbuilder.dev/'
const MAX_CHARS = 8000

const file = process.argv[2]
if (!file) {
  console.error('Usage: node share-link.mjs <map.hexa>')
  process.exit(1)
}

let map
try {
  map = JSON.parse(readFileSync(file, 'utf8'))
} catch (error) {
  console.error(`Could not read ${file} as JSON: ${error.message}`)
  process.exit(1)
}
if (map?.app !== 'domainrings' || map?.version !== 2) {
  console.error('Not a domainrings map: expected "app": "domainrings" and "version": 2.')
  process.exit(1)
}

const link = `${APP_URL}#m=${deflateRawSync(JSON.stringify(map)).toString('base64url')}`
console.log(link)
if (link.length > MAX_CHARS) {
  console.error(`Warning: the link is ${link.length} characters, over the app's ${MAX_CHARS}-character budget. It may not survive chat apps or browsers; share the .hexa file instead (open it with "Open…").`)
}
