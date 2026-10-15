#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const PACKAGE_NAME = '@pbuilder/domainrings'

// https://semver.org, the official regular expression.
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

export function releaseProblems({ name, version }, published) {
  const problems = []
  if (name !== PACKAGE_NAME) problems.push(`package name is "${name}", expected ${PACKAGE_NAME}.`)
  if (!SEMVER.test(version)) problems.push(`version "${version}" is not valid semver.`)
  if (published) problems.push(`${name}@${version} is already published; bump the version in cli/package.json.`)
  return problems
}

// `npm view` exits 0 with no output for an unknown version of a known package, and E404 for an unknown package.
// The registry comes from npm's own config (npm_config_registry in CI), so there is no URL to keep in sync.
export function isPublished({ name, version }, run = spawnSync) {
  const view = run('npm', ['view', `${name}@${version}`, 'version'], { encoding: 'utf8' })
  if (view.error) throw new Error(`could not query the registry: ${view.error.message}`)
  if (view.status === 0) return view.stdout.trim() !== ''
  if (view.stderr.includes('E404')) return false
  throw new Error(`could not query the registry: ${view.stderr.trim() || `npm failed with exit status ${view.status}`}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const problems = releaseProblems(pkg, isPublished(pkg))
  if (problems.length > 0) {
    for (const problem of problems) console.error(`validate-release: ${problem}`)
    process.exit(1)
  }
  console.log(`version=${pkg.version}`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${pkg.version}\n`)
}
