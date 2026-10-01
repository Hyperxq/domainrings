import { flushSync } from 'react-dom'
import { HEXAGONAL_KIND } from '../../model/kinds'
import { parentCandidates } from '../../model/links'
import { defaultWall, DomainTypeSchema, DRIVING_WALLS, SideSchema, WallSchema, type Diagram, type HexaMap, type Side, type Wall } from '../../model/schema'
import { useMapStore } from '../../model/store'
import { revealInEditor } from '../revealInEditor'
import { useHistoryStore } from '../state/historyStore'
import { ItemSection } from './ItemSection'
import { LinkSelect } from './LinkSelect'

const { addItem } = useMapStore.getState()

const WALL_LABEL: Record<Wall, string> = { nw: 'North-west', w: 'West', sw: 'South-west', ne: 'North-east', e: 'East', se: 'South-east' }

const DOMAIN_TYPE_LABEL = { entity: 'Entity', valueObject: 'Value object', aggregate: 'Aggregate', domainService: 'Domain service' }

const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a')
const capitalise = (text: string) => text[0].toUpperCase() + text.slice(1)

/** A new port lands on its side's default wall, with the caret already in its name. */
function addPort(hexId: string, side: Side) {
  let id = ''
  flushSync(() => {
    id = addItem(hexId, 'ports', { side, wall: defaultWall(side) })
  })
  revealInEditor(id, true)
}

function adaptersBySide(d: Diagram) {
  const portSide = new Map(d.ports.map((p) => [p.id, p.side]))
  return (side: Side) => d.adapters.filter((a) => (a.portId ? portSide.get(a.portId) === side : true))
}

/** The six collection sections of one hexagon (domain, use cases, ports, adapters, actors, external systems), each
 * configured with the extra fields its items carry. */
export function CollectionSections({
  hexId,
  map,
  diagram,
}: {
  hexId: string
  map: HexaMap
  diagram: Diagram
}) {
  const labels = HEXAGONAL_KIND.labels
  const adaptersOn = adaptersBySide(diagram)
  const sideLabel: Record<Side, string> = { driving: labels.drivingPort, driven: labels.drivenPort }
  return (
    <>
      <ItemSection
        hexId={hexId}
        map={map}
        collection="domain"
        items={diagram.domain}
        title="Domain"
        noun="domain item"
        empty="No domain items yet. Add the entities and value objects at the core."
        fields={(item, update) => (
          <>
            <label className="field">
              <span>Type</span>
              <select value={item.type} onChange={(e) => update({ type: DomainTypeSchema.parse(e.target.value) })}>
                {DomainTypeSchema.options.map((t) => <option key={t} value={t}>{DOMAIN_TYPE_LABEL[t]}</option>)}
              </select>
            </label>
            <LinkSelect label="Belongs to" value={item.parentId} options={parentCandidates(diagram.domain, item.id)} onChange={(parentId) => update({ parentId })} />
          </>
        )}
      />

      <ItemSection
        hexId={hexId}
        map={map}
        collection="useCases"
        items={diagram.useCases}
        title="Use cases"
        noun="use case"
        empty="No use cases yet. Add what the application does."
        fields={(item, update) => (
          <label className="field">
            <span>Placement</span>
            <select aria-label="Placement" value={item.placement ?? 'top'} onChange={(e) => update({ placement: e.target.value === 'top' ? undefined : WallSchema.parse(e.target.value) })}>
              <option value="top">Under the title</option>
              {WallSchema.options.map((w) => <option key={w} value={w}>{WALL_LABEL[w]}</option>)}
            </select>
          </label>
        )}
      />

      <ItemSection
        hexId={hexId}
        map={map}
        collection="ports"
        items={diagram.ports}
        title="Ports"
        noun="port"
        actions={SideSchema.options.map((side) => (
          <button
            key={side}
            type="button"
            className="text-button small"
            aria-label={`Add ${article(sideLabel[side])} ${sideLabel[side]}`}
            title={`Add ${article(sideLabel[side])} ${sideLabel[side]}`}
            onClick={() => {
              useHistoryStore.getState().record({ map, focus: hexId })
              addPort(hexId, side)
            }}
          >
            + {sideLabel[side].split(' ')[0]}
          </button>
        ))}
        groups={SideSchema.options.map((side) => ({ key: side, title: `${capitalise(sideLabel[side])}s`, items: diagram.ports.filter((p) => p.side === side) }))}
        empty="No ports yet. Add one per boundary the use cases expose or need."
        fields={(item, update) => (
          <>
            <label className="field">
              <span>Side</span>
              {/* A wall belongs to one side's half, so changing side drops it back to that side's default. */}
              <select value={item.side} onChange={(e) => update({ side: SideSchema.parse(e.target.value), wall: undefined })}>
                {SideSchema.options.map((s) => <option key={s} value={s}>{sideLabel[s]}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Wall</span>
              <select value={item.wall ?? defaultWall(item.side)} onChange={(e) => update({ wall: WallSchema.parse(e.target.value) })}>
                {WallSchema.options
                  .filter((w) => DRIVING_WALLS.has(w) === (item.side === 'driving'))
                  .map((w) => <option key={w} value={w}>{WALL_LABEL[w]}</option>)}
              </select>
            </label>
            <LinkSelect label="Use case" value={item.useCaseId} options={diagram.useCases} onChange={(useCaseId) => update({ useCaseId })} />
          </>
        )}
      />

      <ItemSection
        hexId={hexId}
        map={map}
        collection="adapters"
        items={diagram.adapters}
        title="Adapters"
        noun="adapter"
        empty="No adapters yet. Add the code that plugs into a port."
        fields={(item, update) => (
          <LinkSelect label="Port" value={item.portId} options={diagram.ports.map((p) => ({ id: p.id, name: `${p.name} (${sideLabel[p.side]})` }))} onChange={(portId) => update({ portId })} />
        )}
      />

      <ItemSection
        hexId={hexId}
        map={map}
        collection="actors"
        items={diagram.actors}
        title="Actors"
        noun="actor"
        empty="No actors yet. Add who or what drives the application."
        fields={(item, update) => (
          <LinkSelect label="Calls adapter" value={item.adapterId} options={adaptersOn('driving')} onChange={(adapterId) => update({ adapterId })} />
        )}
      />

      <ItemSection
        hexId={hexId}
        map={map}
        collection="externals"
        items={diagram.externals}
        title="External systems"
        noun="external system"
        empty="No external systems yet. Add databases, APIs and services the adapters talk to."
        fields={(item, update) => (
          <LinkSelect label="Used by adapter" value={item.adapterId} options={adaptersOn('driven')} onChange={(adapterId) => update({ adapterId })} />
        )}
      />
    </>
  )
}
