import { beforeEach, describe, expect, it } from 'vitest'
import { EXAMPLE_DIAGRAM } from '../../model/example'
import { toMap } from '../../model/hexa'
import { useMapStore } from '../../model/store'
import { useHistoryStore } from './historyStore'
import { useNoticeStore } from './noticeStore'

const { show } = useNoticeStore.getState()
beforeEach(() => useMapStore.getState().replace(toMap(EXAMPLE_DIAGRAM)))

describe('notice store', () => {
  it('numbers each notice so a repeated message restarts the toast', () => {
    show({ tone: 'status', message: 'Same.' })
    const first = useNoticeStore.getState().notice!.id
    show({ tone: 'status', message: 'Same.' })
    expect(useNoticeStore.getState().notice!.id).toBe(first + 1)
  })

  it('records the undo a notice offers', () => {
    const { map, focus } = useMapStore.getState()
    show({ tone: 'status', message: 'Edited.', undo: { map, focus } })
    expect(useHistoryStore.getState().stack).toHaveLength(1)
  })

  it('retracting a notice also takes its undo step back', () => {
    const { map, focus } = useMapStore.getState()
    show({ tone: 'status', message: 'Added.', undo: { map, focus } })
    useNoticeStore.getState().retract()
    expect(useNoticeStore.getState().notice).toBeNull()
    expect(useHistoryStore.getState().stack).toHaveLength(0)
  })

  it('lets a link-mode hint replace a status toast but never an error', () => {
    show({ tone: 'status', message: 'Done.' })
    useNoticeStore.getState().clearStatus()
    expect(useNoticeStore.getState().notice).toBeNull()
    show({ tone: 'error', message: 'Broken.' })
    useNoticeStore.getState().clearStatus()
    expect(useNoticeStore.getState().notice?.message).toBe('Broken.')
  })

  it('clears a sticky notice once the map moves past the one it reports', () => {
    const after = useMapStore.getState().map
    show({ tone: 'status', message: 'Deleted.', sticky: true, staleWhenMapIsnt: after })
    expect(useNoticeStore.getState().notice).not.toBeNull()
    useMapStore.getState().setMeta(useMapStore.getState().focus, { title: 'Renamed' })
    expect(useNoticeStore.getState().notice).toBeNull()
  })

  it('keeps the recovery notice apart from the toast, with its saved copy only when one was kept', () => {
    useNoticeStore.getState().reportRecovery('kept', '{x')
    show({ tone: 'status', message: 'Done.' })
    expect(useNoticeStore.getState().recovery?.download).toBe('{x')
    useNoticeStore.getState().reportRecovery('not-kept')
    expect(useNoticeStore.getState().recovery?.download).toBeUndefined()
    useNoticeStore.setState({ recovery: null })
    useNoticeStore.getState().reportRecovery('none')
    expect(useNoticeStore.getState().recovery).toBeNull()
  })
})
