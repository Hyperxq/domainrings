# domainrings

Sketch hexagonal, clean and onion architectures from a structured model. You fill in domain items, use cases, ports, adapters, actors and external systems, and the diagram lays itself out as an SVG. There is no free drag and drop. The workspace (dot-grid canvas, floating toolbar, editor and zoom islands) borrows from Excalidraw; the diagram itself is crisp.

## Run

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # vitest run
npm run typecheck  # tsc --noEmit
```

## How it is built

- `src/model/schema.ts` is the Zod schema and the single source of truth for types (`z.infer`), `.hexa` import validation (ids unique, references resolve) and the reference table the store uses to unlink on delete.
- `src/model/kinds.ts` holds one config per architecture kind: ring names, ring roles, shape and labels. It is one semantic model with three skins.
- `src/layout/layout.ts` is the pure engine, `Diagram → LayoutModel` with absolute coordinates. Boxes are typed text lines (`src/layout/text.ts` holds the metrics), rows are planned first, and then the rings are solved from the inside out so each one hugs the real corners of what it holds. Hexagon rings are regular and concentric (six equal sides, pointy-top). Each ring's circumradius is the smallest that keeps every box corner inside the real hexagon edges, with port and adapter rows on its straight vertical side.
- Ring titles sit centred under each ring's top vertex (or arc). The use cases hang under the application title.
- Arrows are orthogonal. Rows that share a y are single horizontal runs. Each use case gets one vertical bus per side, in the gap between the inner ring and the socket column, and its verb ("uses", "runs the use case") sits flat above the exit run. Composition wiring leaves the root box sideways to one trunk per side just outside the outer ring. Each branch runs inward along the empty row gap under its adapter and turns up into the adapter's bottom edge, so a branch crosses each ring edge at most once and never crosses a box.
- The domain is drawn as centred lines on the ring axis: each root shows its name and type, and each descendant (`parentId` in the model) is one smaller muted line under it. Childless domain services come next, then the driven ports the domain declares (`driven-ports/`). Past 8 lines the tree flows into two balanced columns without separating a root from its descendants, and more than 4 declared ports split the same way. A two-tone dotted line links each declared port to its socket. Each use case sends one arrow down into the domain ("asks the domain to decide"); no import arrow ever leaves the domain.
- Every ring title sits at one shared depth under its ring's top vertex (or arc): the depth where the widest title fits the hexagon's slope. Titles default per kind and can be overridden per diagram (`layers` in the model, the Layers section in the editor), with an optional sentence-case subtitle line. Rings grow rather than move their titles, and the domain title stays in the upper half even when the domain is empty.
- An aggregate root and its descendants are drawn inside a thin rounded outline tagged "aggregate": the aggregate's consistency boundary.
- `src/render/Diagram.tsx` maps the LayoutModel to plain SVG elements (orthogonal paths with small rounded elbows) and contains no geometry.
- `src/ui/*` holds the floating islands (toolbar, editor, zoom), the pan/zoom viewport maths, and the SVG/PNG exporters.

## Ports on any wall (hexagonal)

A port is still driving or driven. In the hexagonal kind it can also sit on any wall of its side's half: `nw`, `w` or `sw` for driving ports, and `ne`, `e` or `se` for driven ones (`Port.wall`, default `w` / `e`; import rejects a wall from the other half). Clean and Onion ignore `wall` and keep their left and right columns.

- **Placement.** Every wall-hosted box is placed in its wall's frame, `(apothem + v)·n + u·dir`, where `n` is the outward normal and `dir` runs along the wall.
  - Ports on one wall are spread evenly along it, centred on the midpoint.
  - A socket straddles the wall and is rotated with it.
  - Its adapter sits further out along the normal, upright; the actor or external sits outside the outer ring on the same normal.
- **Sizing.** The rings grow until three things hold:
  - Every wall box stays inside its wall's 60° sector, 8 units clear of the spokes.
  - No slanted socket touches the title, a use case, or a use-case run it does not serve.
  - Adapters stay inside the adapter ring.
- **Routing.**
  - The w and e walls keep the orthogonal routes.
  - On a slanted wall, endpoint ↔ adapter ↔ socket are straight runs along the wall normal, so each arrow meets the wall at a right angle.
  - Use case → slanted socket leaves the use case sideways to its bus lane, runs down the lane to where the socket's normal crosses it, then runs along that normal into the socket's inner face.
  - An ownership link does the same from its own lane, meeting the socket a quarter of its length off-centre.
  - The composition trunk hugs the outer hexagon just outside it. Each branch runs in along its wall's normal to the adapter, a quarter of the box off the endpoint arrow, so it never crosses an endpoint.

## Use cases on a wall (hexagonal)

A use case normally stacks under the application title. In a hexagon its `placement` can name a wall instead (`nw`, `w`, `sw`, `ne`, `e`, `se`); `top` or no placement keeps the stack, and circles ignore it like they ignore port walls. A seated use case sits upright in that wall's sector, inside the application band: set in from the wall past its sockets (and their Overview names) by the room an arrow needs, 8 clear of the spokes, and stacked along the wall like ports, the run centred on the ports it serves there. Once any use case is seated, the w/e columns keep to their sectors too, so no two walls' content can meet.

Routing: a port on the same wall runs straight in along the wall normal (labelled). Ports on other walls still use the bus; a seated use case first steps to just past the domain's top or bottom, then crosses to its lane, so it never runs through the domain. Its question to the domain leaves along the sector's bisector and lands square on the domain's matching wall, stepping along the wall first when it sits past that wall's end. On Application hover each sector offers its own "+ use case".

## Visual language

One channel per meaning:
- **Colour = layer or side:** amber for the driving side, teal for application, solid teal for domain, slate for the driven side and external systems.
- **Stroke = role:** dashed for contracts (ports), solid for implementations (adapters, use cases), dotted for wiring and ownership.
- **Glyph + word = type:**
  - `◆ aggregate`, `● entity`, `○ value object`, `⚙ domain service`
  - `▶ use case`
  - `⇥ driving port`, `⇤ driven port`, and the adapter eyebrows (port and adapter tags use each kind's own vocabulary)

A collapsible legend island (bottom-right) lists all three channels. It shows only the element types the diagram uses. It is also drawn into SVG and PNG exports under the diagram's bottom-right corner, unless "Include legend in export" is off.

## Modes and guides

- **Detailed** (the default) shows everything: type tags, notes, use-case buses, ownership links and the composition root.
- **Overview** is the calm version. Pills show names only, sockets are bare notches on the application ring edge, and only the straight horizontal flow arrows remain. The domain lists its aggregate and entity roots under the big title. Its smaller boxes give smaller rings.
- **Guides** switches the dashed spokes that run from the domain's vertices to the outer ring's (hexagons only).

In Overview a socket is only a notch, so its port name (the contract) is written beside it inside the application ring, in 11px mono. On the w and e walls it runs flat from the notch toward the centre. On a slanted wall it lies along the wall, upright, starting level with the notch's upper end and running downhill, so upper-wall names stay clear of the application title. The ring solver sizes the application ring around these names: they never touch a use case, the title, the domain ring (a full gap stays clear) or each other, and with any slanted wall in use they keep clear of the spokes like every other wall box.

The mode and the guides switch are remembered, and exports use whatever is on screen.

## Layer hover

Hovering a ring band (or tabbing to it) highlights that layer. The band brightens, thickens, glows and titles in ink; its elements get a brighter border; everything else dims to 55% opacity. Hovering an element highlights the layer it belongs to. Esc or leaving the canvas clears it. Motion is skipped under reduced motion, and exports never carry the hover state.

The **Highlight** toolbar toggle (remembered, on by default) turns the dimming and glow off. Hovering still tracks the layer, so the "+" buttons below keep working.

## Adding on the canvas

A hovered or focused layer shows one "+" per place something can be added: a domain root or child (a small menu asks aggregate, entity or value object), a use case, a port on each hexagon wall (a side in the rectangle and circle), an adapter per port, and an endpoint per adapter. The "+" buttons are HTML over the stage, so they never enter the SVG, the export or the layout. Where they go comes from `insertionPoints(model, diagram, mode)` in `src/layout/insertion.ts`, a pure function of the laid-out model.

Picking one creates the element with a placeholder name and opens a name field over it. Enter commits, Esc removes the element, and blur commits (or removes the element if the name is empty). The editor then scrolls to the new item and flashes it.

## Editing from the canvas

Double-click any element (a domain item, use case, port, adapter, actor, external system or the composition root) to open the editor at its card: the editor expands if it was collapsed, the card scrolls to the centre and flashes, and its name is selected, ready to type over. Double-clicking a layer's title or band goes to that layer's fieldset under Layers. Elements are focusable, so Tab to one and press Enter to do the same. A press only becomes a pan once the pointer moves more than 3 px, so clicks and double-clicks reach the element under them, and the canvas never selects its own text.

## Examples

Load an example from the toolbar: the chat feedback slice, a stress test (10 domain items, 3 use cases, 6 driven ports) that shows how the layout grows, or "Two slices, one link (preview)" — two hexagons connected by one link, previewing the context-map view. Adding a hexagon or editing a link from the UI arrives in a later release; for now the preview example is the only way to see a multi-hexagon map.

## File format

A `.hexa` file is the diagram JSON plus `"app": "domainrings"` (files saved as `"archviz"` before the rename still open and re-save as `"domainrings"`). Autosave writes the same format to `localStorage` under `domainrings:diagram`, plus a `seedVersion`. If a stored diagram is still byte-identical to an older seed (it was never edited), it is replaced with the current seed; edited diagrams are always kept.

## Fonts

The app loads IBM Plex Sans and IBM Plex Mono from Google Fonts. SVG and PNG exports fetch the Latin faces at export time and embed them as data URIs. If they can't be fetched (offline), the export falls back to the system font stack.
