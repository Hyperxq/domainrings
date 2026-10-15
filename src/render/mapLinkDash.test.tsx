import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

let style: HTMLStyleElement
beforeEach(() => {
  style = document.createElement('style')
  style.textContent = readFileSync(resolve(__dirname, '../styles.css'), 'utf-8')
  document.head.appendChild(style)
})
afterEach(() => {
  style.remove()
  document.body.innerHTML = ''
})

const dashOf = (attrs: string) => {
  document.body.innerHTML = `<svg><path ${attrs} d="M0 0L10 0" /></svg>`
  return getComputedStyle(document.querySelector('path')!).strokeDasharray
}

describe('map link dash', () => {
  it('draws a thread-coloured link solid, so its colour reads unbroken', () => {
    expect(dashOf('class="map-link" data-thread=""')).toBe('none')
  })

  it('keeps a neutral link dashed', () => {
    expect(dashOf('class="map-link"')).toBe('6 4')
  })

  it('keeps a planned link dashed even when it wears a thread colour', () => {
    expect(dashOf('class="map-link planned" data-thread=""')).toBe('6 4')
  })
})
