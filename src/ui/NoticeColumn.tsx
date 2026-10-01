import { download } from './exporters'
import { Icon } from './Icon'
import { useSaveFailed } from '../model/persistence'
import { useNoticeStore } from './state/noticeStore'

const SAVE_FAILED_MESSAGE = "Your latest changes couldn't be saved in this browser and may be lost if you reload. This notice clears after the next successful save."

export function NoticeColumn() {
  const notice = useNoticeStore((s) => s.notice)
  const recoveryNotice = useNoticeStore((s) => s.recovery)
  const saveFailed = useSaveFailed((s) => s.failed)
  return (
    // One positioned column for all of them — independently fixed-position notices could sit at the same spot.
    <div className="notices">
      {notice?.tone === 'error' && (
        <section className="island notice notice-error" role="alert">
          <p>{notice.message}</p>
          {notice.details && (
            <ul>
              {notice.details.map((d) => <li key={d}>{d}</li>)}
            </ul>
          )}
          <div className="notice-actions">
            <button type="button" className="icon-button small" aria-label="Dismiss" onClick={() => useNoticeStore.setState({ notice: null })}>
              <Icon name="close" />
            </button>
          </div>
        </section>
      )}
      {saveFailed && (
        <section className="island notice" role="status" aria-live="polite">
          <p>{SAVE_FAILED_MESSAGE}</p>
        </section>
      )}
      {recoveryNotice && (
        <section className="island notice" role="status" aria-live="polite">
          <p>{recoveryNotice.message}</p>
          <div className="notice-actions">
            {recoveryNotice.download !== undefined && (
              <button type="button" className="text-button" onClick={() => download(recoveryNotice.download!, 'unreadable-session.hexa', 'application/json')}>
                Download saved copy
              </button>
            )}
            <button type="button" className="icon-button small" aria-label="Dismiss" onClick={() => useNoticeStore.setState({ recovery: null })}>
              <Icon name="close" />
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
