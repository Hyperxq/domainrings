import { describe, expect, it } from 'vitest'
import { PACKAGE_NAME, releaseProblems } from '../scripts/validate-release.mjs'

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
