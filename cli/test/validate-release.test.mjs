import { describe, expect, it, vi } from 'vitest'
import { PACKAGE_NAME, isPublished, releaseProblems } from '../scripts/validate-release.mjs'

const ok = { name: PACKAGE_NAME, version: '0.2.0' }

describe('releaseProblems', () => {
  it('accepts the canonical name with a valid unpublished version', () => {
    expect(releaseProblems(ok, false)).toEqual([])
  })

  it('accepts prerelease and build metadata versions', () => {
    expect(releaseProblems({ ...ok, version: '1.0.0-rc.1+build.5' }, false)).toEqual([])
  })

  it('rejects any other package name', () => {
    expect(releaseProblems({ ...ok, name: 'domainrings' }, false)).toEqual([expect.stringContaining(PACKAGE_NAME)])
  })

  it.each(['1.0', 'v1.0.0', '01.0.0', '1.0.0.0', ''])('rejects the invalid semver "%s"', (version) => {
    expect(releaseProblems({ ...ok, version }, false)).toEqual([expect.stringContaining('semver')])
  })

  it('rejects a version already on the registry', () => {
    expect(releaseProblems(ok, true)).toEqual([expect.stringContaining('already published')])
  })

  it('reports every problem at once', () => {
    expect(releaseProblems({ name: 'x', version: 'nope' }, true)).toHaveLength(3)
  })
})

describe('isPublished', () => {
  const pkg = { name: PACKAGE_NAME, version: '0.2.0' }
  const viewing = (result) => vi.fn(() => result)

  it('is published when npm prints the version', () => {
    expect(isPublished(pkg, viewing({ status: 0, stdout: '0.2.0\n', stderr: '' }))).toBe(true)
  })

  it('is not published when npm succeeds with no output', () => {
    expect(isPublished(pkg, viewing({ status: 0, stdout: '', stderr: '' }))).toBe(false)
  })

  it('is not published when the package is unknown (E404)', () => {
    expect(isPublished(pkg, viewing({ status: 1, stdout: '', stderr: 'npm error code E404' }))).toBe(false)
  })

  it('surfaces a spawn failure instead of reading it as unpublished', () => {
    const run = viewing({ status: null, stdout: null, stderr: null, error: new Error('spawn npm ENOENT') })
    expect(() => isPublished(pkg, run)).toThrow(/could not query the registry.*ENOENT/)
  })

  it('surfaces any other npm failure', () => {
    expect(() => isPublished(pkg, viewing({ status: 1, stdout: '', stderr: 'npm error code ETIMEDOUT' }))).toThrow(/ETIMEDOUT/)
  })

  it('names the exit status when npm fails silently', () => {
    expect(() => isPublished(pkg, viewing({ status: 2, stdout: '', stderr: '' }))).toThrow(/exit status 2/)
  })
})
