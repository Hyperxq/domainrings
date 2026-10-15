#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { parseArgs } from 'node:util'
import { MAX_CHARS, openerCommand, readMap, resolveFlow, shareLink } from '../src/link.mjs'

const USAGE = `Usage:
  domainrings link <file.hexa> [--flow <id|name>] [--hex <hexagonId>] [--open] [--base-url <url>]
  domainrings render <file.hexa> [--flow <id|name|all>] [--hex <id>] [--out <dir>] [--format png|svg] [--base-url <url>]`

const fail = (message) => {
  console.error(`domainrings: ${message}`)
  process.exit(1)
}

const [command, ...rest] = process.argv.slice(2)
const commands = {
  link: {
    options: { flow: { type: 'string' }, hex: { type: 'string' }, open: { type: 'boolean' }, 'base-url': { type: 'string' } },
    async run([file], values) {
      const map = readMap(file)
      const flow = values.flow === undefined ? undefined : resolveFlow(map, values.flow, values.hex)
      if (flow === undefined && values.hex !== undefined) throw new Error('--hex needs --flow.')
      const link = shareLink(map, { baseUrl: values['base-url'], flow })
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
    options: { flow: { type: 'string' }, hex: { type: 'string' }, out: { type: 'string' }, format: { type: 'string' }, 'base-url': { type: 'string' } },
    async run([file], values) {
      const [{ chromium }, { render }] = await Promise.all([import('playwright-core'), import('../src/render.mjs')])
      await render(file, { flow: values.flow, hex: values.hex, out: values.out, format: values.format, baseUrl: values['base-url'] }, { chromium })
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
