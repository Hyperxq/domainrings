import { useState } from 'react'
import { LinkPatternSchema, type HexaMap, type Link, type LinkEnd } from '../../model/schema'
import { crossHexagonPorts, linkEndLabel, type LinkPatch, type PortRef } from '../../model/map'
import { Fold } from '../Fold'
import { Icon } from '../Icon'
import { LinkSelect } from './LinkSelect'

/** The Links section (REQ-LNK-07): every link in the map, and the create form that is the Links-editor half of
 * "one action, two entry points" (ADR-02) — the canvas "Link to…" chip is the other. Each row also reaches
 * REQ-LNK-02 (edit an end's adapter, or a context-crossing link's pattern) and REQ-LNK-04 (delete) — reconnecting
 * an end to a different port is never offered here (REQ-LNK-03.1): delete + recreate is the only path. */
export function LinksSection({
  map,
  onCreateLink,
  onUpdateLink,
  onDeleteLink,
}: {
  map: HexaMap
  onCreateLink: (from: LinkEnd, to: LinkEnd) => void
  onUpdateLink: (id: string, patch: LinkPatch) => void
  onDeleteLink: (id: string) => void
}) {
  const drivenPorts = crossHexagonPorts(map, 'driven')
  const drivingPorts = crossHexagonPorts(map, 'driving')
  const [fromIndex, setFromIndex] = useState<string | undefined>(undefined)
  const [toIndex, setToIndex] = useState<string | undefined>(undefined)
  const [fromAdapter, setFromAdapter] = useState<string | undefined>(undefined)
  const [toAdapter, setToAdapter] = useState<string | undefined>(undefined)
  const fromPort = fromIndex !== undefined ? drivenPorts[Number(fromIndex)] : undefined
  const toPort = toIndex !== undefined ? drivingPorts[Number(toIndex)] : undefined
  // Shared by the create form's chosen-but-not-yet-linked ports (PortRef) and an existing link's own ends
  // (LinkEnd) — both carry the same {hexagonId, portId} the adapter list is keyed on.
  const adapterOptions = (end?: { hexagonId: string; portId: string }) =>
    end ? map.hexagons.find((h) => h.id === end.hexagonId)!.adapters.filter((a) => a.portId === end.portId).map((a) => ({ id: a.id, name: a.name })) : []
  const portOptions = (ports: PortRef[]) => ports.map((p, i) => ({ id: String(i), name: `${p.hexagonTitle} · ${p.portName}` }))
  const patternOptions = LinkPatternSchema.options.map((p) => ({ id: p, name: p }))
  // REQ-LNK-06.2: a pattern only applies to a link whose two hexagons are in different bounded contexts — the
  // same rule checkMap enforces server-side, checked here client-side from the map already in hand.
  const crossesContext = (link: Link) => {
    const fromHexagon = map.hexagons.find((h) => h.id === link.from.hexagonId)!
    const toHexagon = map.hexagons.find((h) => h.id === link.to.hexagonId)!
    return fromHexagon.contextId !== toHexagon.contextId
  }

  // Omits adapterId entirely when none is chosen (rather than an explicit undefined), so a link created from here
  // is toStrictEqual to the same link created from the canvas chip (App.tsx's onLink builds its LinkEnd the same
  // lean way) — REQ-LNK-01.2's "identical link" is about the object shape, not just its meaning.
  const endOf = (port: PortRef, adapterId?: string): LinkEnd => (adapterId ? { hexagonId: port.hexagonId, portId: port.portId, adapterId } : { hexagonId: port.hexagonId, portId: port.portId })

  const submit = () => {
    if (!fromPort || !toPort) return
    onCreateLink(endOf(fromPort, fromAdapter), endOf(toPort, toAdapter))
    setFromIndex(undefined)
    setToIndex(undefined)
    setFromAdapter(undefined)
    setToAdapter(undefined)
  }

  return (
    <Fold id="links" title="Links" count={map.links.length}>
      {!map.links.length ? (
        <p className="empty">No links yet. Connect a driven port to a driving port on another hexagon.</p>
      ) : (
        <ul className="items">
          {map.links.map((link) => (
            <li key={link.id} className="item" data-item-id={link.id}>
              <span className="link-row-label">
                {linkEndLabel(map, link.from)} → {linkEndLabel(map, link.to)}
              </span>
              <button
                type="button"
                className="icon-button small remove"
                aria-label={`Delete link ${linkEndLabel(map, link.from)} to ${linkEndLabel(map, link.to)}`}
                title="Delete link"
                onClick={() => onDeleteLink(link.id)}
              >
                <Icon name="close" />
              </button>
              <details className="link-edit">
                <summary>Edit</summary>
                <LinkSelect
                  label="Driven port adapter"
                  value={link.from.adapterId}
                  options={adapterOptions(link.from)}
                  onChange={(adapterId) => onUpdateLink(link.id, { from: { adapterId: adapterId ?? null } })}
                />
                <LinkSelect
                  label="Driving port adapter"
                  value={link.to.adapterId}
                  options={adapterOptions(link.to)}
                  onChange={(adapterId) => onUpdateLink(link.id, { to: { adapterId: adapterId ?? null } })}
                />
                {crossesContext(link) && (
                  <LinkSelect
                    label="Pattern"
                    value={link.pattern}
                    options={patternOptions}
                    onChange={(pattern) => onUpdateLink(link.id, { pattern: (pattern as Link['pattern']) ?? null })}
                  />
                )}
              </details>
            </li>
          ))}
        </ul>
      )}
      <div className="link-create">
        <LinkSelect label="Driven port" value={fromIndex} options={portOptions(drivenPorts)} onChange={setFromIndex} />
        {fromPort && <LinkSelect label="Driven port adapter" value={fromAdapter} options={adapterOptions(fromPort)} onChange={setFromAdapter} />}
        <LinkSelect label="Driving port" value={toIndex} options={portOptions(drivingPorts)} onChange={setToIndex} />
        {toPort && <LinkSelect label="Driving port adapter" value={toAdapter} options={adapterOptions(toPort)} onChange={setToAdapter} />}
        <button type="button" className="text-button" disabled={!fromPort || !toPort} onClick={submit}>
          Create link
        </button>
      </div>
    </Fold>
  )
}
