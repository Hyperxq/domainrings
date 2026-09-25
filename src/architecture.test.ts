import { posix } from 'node:path'
import { describe, expect, it } from 'vitest'

// Discrimination proof (strict TDD, new file — every rule below was RED before it was written): each of the 5
// rule tests was confirmed to fail when the violation it guards was actually introduced (one mutant per rule,
// applied and reverted): a bogus `../ui/prefs` import added to model/schema.ts broke only "model never imports
// layout, render, or ui"; a `../render/Diagram` import added to layout/map.ts broke only the layout rule; a
// `../ui/Toolbar` import added to render/Diagram.tsx broke only "render never imports ui"; a bare `import React
// from 'react'` added to model/schema.ts broke only the react fence; a bare `import { create } from 'zustand'`
// added to layout/map.ts broke only the zustand fence. Every other rule stayed green in each case.

// Fitness function (SEAM/ADR-01, ADR-04, ADR-05): the one-way layering model → layout → render → ui must hold
// for every source file, not just the ones a slice happened to touch. Reads real source text — a passing test
// here is a property of the CURRENT tree, re-checked on every run, not a fact pinned once and forgotten.
const files = import.meta.glob('./**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const allPaths = Object.keys(files)

// The floor proves the glob actually walked the whole src tree (a typo'd pattern or an empty match would let
// every rule below pass vacuously). Counts every matched file, including tests — the layering rules below
// narrow to production code on their own.
it('reads the whole src tree, not a vacuous subset', () => {
  expect(allPaths.length).toBeGreaterThanOrEqual(40)
})

const isTest = (path: string) => /\.test\.tsx?$/.test(path)
const productionPaths = allPaths.filter((p) => !isTest(p))

type Layer = 'model' | 'layout' | 'render' | 'ui' | 'root' | 'other'

function layerOf(path: string): Layer {
  if (path.startsWith('./model/')) return 'model'
  if (path.startsWith('./layout/')) return 'layout'
  if (path.startsWith('./render/')) return 'render'
  if (path.startsWith('./ui/')) return 'ui'
  if (path === './App.tsx' || path === './main.tsx') return 'root'
  return 'other'
}

/** Bare specifiers (`'zod'`, `'react'`) resolve to `undefined` — only project-relative imports are layering edges. */
function resolveImport(fromPath: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined
  const dir = posix.dirname(fromPath)
  const joined = posix.normalize(posix.join(dir, specifier))
  const candidate = joined.startsWith('.') ? joined : `./${joined}`
  for (const suffix of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
    if (allPaths.includes(candidate + suffix)) return candidate + suffix
  }
  return candidate
}

function importsOf(source: string): string[] {
  const specifiers: string[] = []
  for (const re of [/\bfrom\s+['"]([^'"]+)['"]/g, /\bimport\s+['"]([^'"]+)['"]/g]) {
    for (const match of source.matchAll(re)) specifiers.push(match[1])
  }
  return specifiers
}

/** [file, imported specifier, resolved path] for every project-relative import in the production tree. */
const edges = productionPaths.flatMap((path) =>
  importsOf(files[path])
    .map((specifier) => ({ path, specifier, resolved: resolveImport(path, specifier) }))
    .filter((e): e is { path: string; specifier: string; resolved: string } => e.resolved !== undefined),
)

describe('one-way layering: model → layout → render → ui', () => {
  it('model never imports layout, render, or ui', () => {
    const violations = edges.filter((e) => layerOf(e.path) === 'model' && ['layout', 'render', 'ui'].includes(layerOf(e.resolved)))
    expect(violations.map((v) => `${v.path} -> ${v.specifier}`)).toEqual([])
  })

  it('layout imports only model or layout (never render or ui)', () => {
    const violations = edges.filter((e) => layerOf(e.path) === 'layout' && !['model', 'layout'].includes(layerOf(e.resolved)))
    expect(violations.map((v) => `${v.path} -> ${v.specifier}`)).toEqual([])
  })

  it('render never imports ui', () => {
    const violations = edges.filter((e) => layerOf(e.path) === 'render' && layerOf(e.resolved) === 'ui')
    expect(violations.map((v) => `${v.path} -> ${v.specifier}`)).toEqual([])
  })
})

describe('per-hexagon layout modules stay ignorant of the map', () => {
  // The original single-hexagon modules: composition happens ABOVE them, in layout/map.ts, so they must never
  // learn about HexaMap/multi-hexagon concerns — that boundary is what keeps them composable untouched (ADR-01).
  // model/links.ts is scoped to one Diagram (collectionOf/linkTargets), same as the three layout/ ones, even
  // though its FILE lives in the model layer — a model→model import isn't caught by the general layering rules.
  const PER_HEXAGON_MODULES = ['./layout/layout.ts', './layout/insertion.ts', './model/links.ts', './layout/legend.ts']

  it('never import model/map', () => {
    const violations = edges.filter((e) => PER_HEXAGON_MODULES.includes(e.path) && e.resolved === './model/map.ts')
    expect(violations.map((v) => `${v.path} -> ${v.specifier}`)).toEqual([])
  })

  it('never mention HexaMap by name', () => {
    const violations = PER_HEXAGON_MODULES.filter((p) => files[p].includes('HexaMap'))
    expect(violations).toEqual([])
  })

  it('layout/hull.ts imports only model or layout (scoped pin, on top of the general layout-layer rule above)', () => {
    const violations = edges.filter((e) => e.path === './layout/hull.ts' && !['model', 'layout'].includes(layerOf(e.resolved)))
    expect(violations.map((v) => `${v.path} -> ${v.specifier}`)).toEqual([])
  })
})

describe('dependency fences', () => {
  it('react is imported only from render, ui, App.tsx, or main.tsx', () => {
    const violations = productionPaths.filter((p) => !['render', 'ui', 'root'].includes(layerOf(p)) && importsOf(files[p]).some((s) => s === 'react' || s.startsWith('react/') || s === 'react-dom' || s.startsWith('react-dom/')))
    expect(violations).toEqual([])
  })

  it('zustand is imported only from model/store.ts or model/persistence.ts', () => {
    const allowed = new Set(['./model/store.ts', './model/persistence.ts'])
    const violations = productionPaths.filter((p) => !allowed.has(p) && importsOf(files[p]).some((s) => s === 'zustand' || s.startsWith('zustand/')))
    expect(violations).toEqual([])
  })
})
