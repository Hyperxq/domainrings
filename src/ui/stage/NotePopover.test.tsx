import { cleanup, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { NotePopover } from './NotePopover'

afterEach(cleanup)

/** The popover mounts while the stage is already up, so its ref'd `main` exists by then. */
function renderIn(nodes: string) {
  const mainRef = createRef<HTMLElement>()
  const stage = (withPopover: boolean) => (
    <main ref={mainRef}>
      <svg dangerouslySetInnerHTML={{ __html: nodes }} />
      {withPopover && <NotePopover mainRef={mainRef} refId="uc" text="a note" />}
    </main>
  )
  const { rerender } = render(stage(false))
  rerender(stage(true))
}

describe('NotePopover', () => {
  it('shows the note once its element is on the canvas', () => {
    renderIn('<g class="node node-useCase" data-ref="uc"></g>')
    expect(screen.getByRole('tooltip').textContent).toBe('a note')
  })

  it('renders nothing when its element is not on the canvas, rather than sitting at the corner', () => {
    renderIn('<g class="node node-useCase" data-ref="other"></g>')
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
