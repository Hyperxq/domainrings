#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { parseArgs } from 'node:util'
import { DEFAULT_STORE_URL, MAX_CHARS, openerCommand, readMap, resolveFlow, shareLink, storedLink, storeMap } from '../src/link.mjs'

const USAGE = `Usage:
  domainrings link <file.hexa> [--flow <id|name>] [--hex <hexagonId>] [--open] [--full] [--base-url <url>] [--store <url>]
  domainrings render <file.hexa> [--flow <id|name|all>] [--hex <id>] [--out <dir>] [--format png|svg] [--palette <default|purple|terracotta|cool>] [--theme <dark|light>] [--base-url <url>]`

const fail = (message) => {
  console.error(`domainrings: ${message}`)
  process.exit(1)
}

const [command, ...rest] = process.argv.slice(2)
const commands = {
  link: {
    options: { flow: { type: 'string' }, hex: { type: 'string' }, open: { type: 'boolean' }, full: { type: 'boolean' }, 'base-url': { type: 'string' }, store: { type: 'string' } },
    async run([file], values) {
      const map = readMap(file)
      const flow = values.flow === undefined ? undefined : resolveFlow(map, values.flow, values.hex)
      if (flow === undefined && values.hex !== undefined) throw new Error('--hex needs --flow.')
      const baseUrl = values['base-url']
      // A short link only opens on a deployment that reads the same store, so another --base-url needs its own --store.
      const store = values.store ?? (baseUrl === undefined ? DEFAULT_STORE_URL : undefined)
      let stored
      if (!values.full) {
        stored = store ? await storeMap(map, { store }) : { failure: 'no share store for this --base-url (pass --store <url>)' }
        if (stored.failure) console.error(`Short link unavailable: ${stored.failure}. Printing the full #m= link instead.`)
      }
      const link = stored?.token ? storedLink(stored.token, { baseUrl, flow }) : shareLink(map, { baseUrl, flow })
      console.log(link)
      if (link.length > MAX_CHARS) {
        console.error(`Warning: the link is ${link.length} characters, over the app's ${MAX_CHARS}-character budget. It may not survive chat apps or browsers; share the .hexa file instead (open it with "Open…").`)
      }
      if (values.open) {
        const { command, args } = openerCommand(process.platform, link)
        spawn(command, args, { stdio: 'ignore', detached: true }).on('error', (e) => fail(`could not open the browser: ${e.message}`)).unref()
      }
    },
  },
  render: {
    options: { flow: { type: 'string' }, hex: { type: 'string' }, out: { type: 'string' }, format: { type: 'string' }, palette: { type: 'string' }, theme: { type: 'string' }, 'base-url': { type: 'string' } },
    async run([file], values) {
      const [{ chromium }, { render }] = await Promise.all([import('playwright-core'), import('../src/render.mjs')])
      await render(file, { flow: values.flow, hex: values.hex, out: values.out, format: values.format, palette: values.palette, theme: values.theme, baseUrl: values['base-url'] }, { chromium })
    },
  },
}

const spec = commands[command]
if (!spec) fail(`${command ? `unknown command "${command}"` : 'no command given'}.\n${USAGE}`)
try {
  const { values, positionals } = parseArgs({ args: rest, options: spec.options, allowPositionals: true })
  if (positionals.length !== 1) fail(`expected exactly one .hexa file.\n${USAGE}`)
  await spec.run(positionals, values)
} catch (error) {
  fail(error.message)
}
