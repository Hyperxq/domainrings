import { useRef, useState } from 'react'
import type { Destination } from '../../model/map'
import { useMapStore } from '../../model/store'
import { ChoiceMenu } from '../ChoiceMenu'
import { Fold } from '../Fold'
import type { sessionOf } from './fieldSession'

const { setMapMeta } = useMapStore.getState()

/** The map's own title and the "Add hexagon from file…" import. */
export function MapSection({
  title,
  contextLabel,
  onAddFromFile,
  session,
}: {
  title: string
  contextLabel: string
  /** Reads the picked file (IMP-01): resolves to the step that finishes the import once the author picks a
   * destination when the file holds one hexagon, or to nothing when it needed no question or was refused. */
  onAddFromFile: (file: File) => Promise<((context: Destination) => void) | undefined>
  session: ReturnType<typeof sessionOf>
}) {
  const [pendingImport, setPendingImport] = useState<((context: Destination) => void) | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  return (
    <Fold id="map" title="Map">
      <label className="field">
        <span>Map title</span>
        <input value={title} onChange={(e) => setMapMeta({ title: e.target.value })} {...session} />
      </label>
      <ChoiceMenu
        label="Add hexagon from file…"
        choices={[
          { id: 'same' as const, label: `Import into ${contextLabel}` },
          { id: 'new' as const, label: 'Import into a new bounded context' },
        ]}
        autoOpen={pendingImport !== null}
        onTrigger={pendingImport ? undefined : () => importInputRef.current?.click()}
        onChoose={(context) => {
          pendingImport?.(context)
          setPendingImport(null)
        }}
        onDismiss={() => setPendingImport(null)}
      />
      <input
        ref={importInputRef}
        type="file"
        accept=".hexa,application/json"
        className="visually-hidden"
        aria-label="Add hexagon from a .hexa file"
        onChange={async (e) => {
          const input = e.currentTarget
          const file = input.files?.[0]
          input.value = ''
          if (!file) return
          const choose = await onAddFromFile(file)
          if (choose) setPendingImport(() => choose)
        }}
      />
    </Fold>
  )
}
