# domainrings

Draw your Hexagonal, Onion or Clean architecture as a model, and let the rings lay themselves out.

Welcome, dear software craftsman. If you are here, you are probably learning Domain-Driven Design or putting it to work in a real codebase, and you know how hard it is to keep the picture in your head and the picture on the whiteboard in agreement. I hope this tool helps you with that.

domainrings turns a structured model into a clean diagram of Hexagonal, Onion or Clean architecture — domain items, use cases, ports and adapters for Hexagonal; elements and dependencies placed in rings for Onion and Clean. You describe what exists and how it connects; the layout, the arrows and the rings are drawn for you. There is no free drag and drop, so the diagram always says exactly what the model says.

Open it at **https://diagrams.pbuilder.dev/**. It runs in your browser and saves as you go.

## Start here

1. Open the app. The first time, you see the **Chat feedback slice** example: one feature, drawn end to end.
2. Use **Example** in the toolbar to load another one. Examples are grouped by architecture — Hexagonal, Onion, Clean — and each group offers the same learning path: a small basic example, a stress test, and a larger advanced example. The three advanced examples all model the same e-commerce domain, so you can compare how Hexagonal, Onion and Clean draw the same system.
3. Try three things:
   - Switch between **Overview** and **Detailed**. Overview is the version for a slide; Detailed is the version for a design review.
   - Hover a ring. Its layer lights up and everything else steps back, which is a quick way to ask "what lives in the application layer?"
   - While a ring is highlighted, click one of the **+** buttons that appear on it. That is how you add things.
4. Keep your work: **Export → .hexa** saves the model as a file you can open again later with **Open…**. **Export → SVG** or **PNG** gives you an image for documents and slides. **Copy link** puts a link to the whole map on your clipboard — opening it loads the map straight away, no file needed. All of this works the same whichever architecture is open.

## Read the diagram

The architecture — Hexagonal, Onion or Clean — is chosen once, in the **New** dialog, and is fixed for that file from then on: there is no switching afterwards. Each one lays out as its own kind of diagram, and a file always holds exactly one.

### Hexagonal

Everything in the diagram maps to a concept you use in code. From the centre outwards:

**The domain ring.** The solid ring at the centre holds the heart of your business logic. An **aggregate** is a consistency boundary: it is drawn with its entities and value objects listed under it, inside a thin outline tagged "aggregate". An **entity** has identity that lasts over time; a **value object** is defined only by its values; a **domain service** holds a rule that belongs to no single object. Nothing inside this ring points outwards.

**Use cases.** The application ring around the domain holds the use cases, one per business action (`PlaceOrder`, `CancelOrder`). Each use case sends one arrow into the domain, labelled "asks the domain to decide": the use case orchestrates, the domain decides.

**Ports.** A port is a contract, so it is drawn dashed on the edge of the application ring. A **driving** port (left half) is how the world asks your application to do something: an HTTP command, a queue event. A **driven** port (right half) is something your application needs from the world: a repository, a notifier, a clock.

**Driven ports inside the domain.** The domain lists its driven ports under `driven-ports/`, and a dotted line joins each one to its socket on the wall. That is dependency inversion made visible: the domain declares the interface it needs, and the outside implements it.

**Adapters.** An adapter is the concrete code that plugs into a port, drawn solid in the outer ring. On the driving side it translates a request into a command (`orders.routes`); on the driven side it implements the contract with real technology (`KnexFeedbackRepository`).

**Actors and external systems.** Outside everything sit the things you do not own. An **actor** drives an adapter (a frontend, an admin); an **external system** is what a driven adapter talks to (Postgres, Mailgun, a legacy module).

### Onion

Onion starts with four rings, innermost to outermost: **Domain Model**, **Domain Services**, **Application Services**, and an outer ring that holds UI, Infrastructure and Tests together. Rename any ring, add your own, and remove or reorder the ones in between from the ring's section in the editor; the innermost and outermost rings stay where they are (and can't be removed), and there are always at least two. Removing a ring moves its elements to the next inner ring and clears any kind that ring doesn't allow; moving a ring so a dependency would point outward removes that dependency. Each of these shows a message with **Undo**. Add an element to whichever ring it belongs in, and it takes its place spread evenly around that ring's circumference. A dependency arrow may only point inward or stay within its own ring; while you draw one, the valid targets light up, and choosing a target further out is refused with a message instead of drawn. Actors and external systems can only connect to an element in the outer ring. An Onion file is always one diagram.

### Clean

Clean also has four rings — **Entities**, **Use Cases**, **Interface Adapters**, **Frameworks & Drivers** — but nothing sits directly in a ring: you create and name your own sectors inside it (drawn as wedges), and every element belongs to one. The same inward-or-same-ring rule governs dependencies; which sector an element sits in makes no difference to it. Actors and external systems can only connect to an element in Frameworks & Drivers. A Clean file, too, is always one diagram.

### Element kinds

In Onion and Clean, an element can optionally carry a kind, chosen in its card in the editor and drawn as a small tag above its name on the canvas and in exports. Each ring offers only its own kinds (kinds stay with a ring's original role when it is renamed or moved; a ring you add offers none):

| Ring | Kinds |
|---|---|
| Onion: Domain Model | entity, value object, aggregate, domain event |
| Onion: Domain Services | domain service, repository interface |
| Onion: Application Services | application service |
| Onion: outer ring | UI, infrastructure, test, repository implementation |
| Clean: Entities | entity, value object, aggregate |
| Clean: Use Cases | interactor, input port, output port |
| Clean: Interface Adapters | controller, presenter, gateway |
| Clean: Frameworks & Drivers | framework, database, web, device |

In a `.hexa` file the kind is an optional `kind` field on the element (`entity`, `valueObject`, `aggregate`, `domainEvent`, `domainService`, `repositoryInterface`, `applicationService`, `ui`, `infrastructure`, `test`, `repositoryImplementation`, `interactor`, `inputPort`, `outputPort`, `controller`, `presenter`, `gateway`, `framework`, `database`, `web`, `device`). A file with a kind its ring doesn't allow is refused with a message naming the element.

## Draw your own system

Start with **New** in the toolbar, or edit an example.

- **Add.** Hover a ring and click a **+**: a domain root or an item inside one (a small menu asks aggregate or entity for a root, entity or value object for an item inside), a use case, a port on any wall, an adapter for a port, or an actor or external system for an adapter. A name field opens on the new element: Enter keeps it, Esc removes it. The editor panel on the side has an add button in every section too.
- **Rename.** Double-click any element. The editor opens at its card with the name selected, ready to type over. Double-clicking a ring's title takes you to that layer under **Layers**, where you can change its title and subtitle. With the keyboard, Tab to an element and press Enter.
- **Link.** Click an element to select it. If it can be linked, a **Link to…** chip appears at its corner (or press **L**). The valid targets light up; click one. A port links to a use case, an adapter to a port, an actor or external system to an adapter, and an entity or value object to the aggregate or entity it belongs to. Esc leaves link mode.
- **Move ports between walls.** A port can sit on any wall of its half: north-west, west or south-west for driving ports, north-east, east or south-east for driven ones. Pick the **Wall** in the port's card, or add it straight onto a wall with that wall's **+**.
- **Seat a use case on a wall.** A use case normally stacks under the Application title. Its **Placement** can name a wall instead, and it moves into that wall's sector, next to the ports it serves.
- **Delete.** Select an element and press Delete or Backspace, or use the remove button on its card.
- **Undo.** This holds for every architecture, and for every kind of edit — adding, renaming, deleting, linking (or, in Onion and Clean, depending), plus starting a new diagram, loading an example, opening or importing a file. Each one shows a short message with an **Undo** button. Ctrl+Z (Cmd+Z on a Mac) undoes the latest edit at any time, and repeating it steps back through your last 20 edits, across new, opened and example documents too; the history lives in memory, so a reload clears it. While you are typing in a field, or a menu is open, Ctrl+Z stays with it. Editing a field (a title, an item's name, a note) is one step per edit — from clicking into the field to leaving it — and, like adding an item, it raises no message. Undo declines only if the document changed in a way it did not record, and then the history starts over with your next undoable edit.

Your work autosaves in this browser's `localStorage` a moment after each change, so a reload brings it back. If a save fails (storage full), a notice says so and clears itself after the next successful save. When the browser blocks storage entirely, the same notice shows from the start and stays, since nothing can be saved. Export a `.hexa` file for anything you want to keep or share, and open it again with **Open…**.

## Build a honeycomb

A real system is rarely one slice. domainrings draws several hexagons side by side, each one its own diagram, none of them overlapping: a honeycomb you build by growing the map or bringing in slices you already have as files. Maps and the links between hexagons are Hexagonal only — an Onion or Clean file is always exactly one diagram, with no honeycomb to grow.

- **Grow.** The current hexagon's free sides show a **+**. Click one and choose **Hexagon in {context}** to add a neighbour in the same bounded context, or **Hexagon in a new bounded context** to start a fresh one. The new hexagon appears empty and current, with its title field open: type a name and press Enter, or Esc to undo the whole thing. The Hexagon section of the editor has its own **Add hexagon** button for the same move without touching the canvas.
- **Bring in a file.** The editor's Map section has **Add hexagon from file…**, which opens the file picker first. The file must itself be Hexagonal: an Onion or Clean file is refused, with a message naming its kind. A file with one hexagon then asks where it should land (**Import into {context}** or **Import into a new bounded context**); dismissing that question imports nothing. A file with several hexagons is merged whole without asking: every hexagon, its links and each of its contexts (names kept) are added as new contexts, placed as a block just below the current map. Either way it is one **Undo** step. **Open…** still replaces the whole map.
- **Bounded contexts.** Once a map holds two or more contexts, each one is drawn as a dashed outline with a name chip, even when a context's hexagons aren't all next to each other, or when another context's hexagon sits in the middle of it. Name or rename a context in the editor's **Bounded contexts** section; an unnamed one shows a stable "Context {n}" placeholder that never changes while the context exists. A single-context map draws with no outlines at all, exactly as a lone hexagon always has.
- **Link hexagons.** A link joins a driven port on one hexagon to a driving port on another: the first depends on the second. Select the driven port and use **Link to…**, or the editor's **Links** section; valid ports on other hexagons light up. A link that crosses bounded contexts can carry the DDD relationship it represents (`acl`, `ohs-pl`, `customer-supplier`, `conformist`, `shared-kernel`), drawn as a label on the link.
- **Move.** The Hexagon section's **Move to context…** reassigns the current hexagon to another bounded context, or to a new one, keeping its content and links. A context left with no hexagon disappears. Undo puts it back in one step. A hexagon that is alone in the map's only context has nowhere to go, so the control is disabled.
- **Delete.** The Hexagon section's **Delete hexagon** removes the current hexagon, short of the very last one on the map; its links go with it, and its bounded context too if that hexagon was the only one in it. Undo brings all of it back in one step.
- **Fit to screen.** The zoom controls' **Fit to screen** button shows every hexagon on the map, however far it has grown, at whatever zoom that takes. Growing, importing or deleting a hexagon re-fits the view to the whole map automatically, unless a zoomed-in view already covers the change, which then stays exactly where it is.
- **Compact neighbours.** From four hexagons up, every hexagon but the current one is drawn compact: just its silhouette, its title and how many elements it holds (domain items, use cases, ports, adapters, actors and externals). That keeps a big map legible at **Fit to screen**. Click a compact hexagon, or focus it and press Enter or Space, to make it current and expand it; the one you leave collapses. Each of its ports shows as a small marker on the wall it sits on, and links end on those markers. In link mode, click a marker (or Tab to it and press Enter or Space) to link to that port, exactly as you would on a full hexagon. Maps of one to three hexagons always draw every hexagon in full.
- **Export scope.** Once a map holds more than one hexagon, Export offers a scope: **Map** exports everything as it is on screen (every hexagon, compact ones included, every link, every context's outline and chip), **Hexagon** exports just the current one, framed to its own bounds.

## Let your AI assistant draw it

The repo ships an agent skill, `domainrings`, that teaches an AI coding assistant to read your code, write the `.hexa` map for its hexagonal architecture (one hexagon or a whole honeycomb), and hand you a link that opens it here. It covers Hexagonal only for now — Onion and Clean aren't supported by the skill yet. Install it with the [skills](https://github.com/vercel-labs/skills) CLI, which works with Claude Code, Cursor, Codex and other agents:

```sh
npx skills add Hyperxq/domainrings --skill domainrings
```

Then ask your assistant to draw your hexagon. The skill lives in `skills/domainrings/`.

## Reference

### Visual language

Each meaning has one channel, and a collapsible legend in the bottom-right corner lists them:

- **Colour = layer or side:** indigo for the driving side, rust for the driven side, teal for the application ring and a solid teal domain, slate for the outer ring and external systems.
- **Stroke = role:** dashed for contracts (ports), solid for implementations (adapters, use cases), dotted for wiring and ownership.
- **Glyph + word = type:** `◆ aggregate`, `● entity`, `○ value object`, `⚙ domain service`, `▶ use case`, `⇥` for the driving side and `⇤` for the driven side.

The legend shows only the types your diagram uses, and it is drawn into SVG and PNG exports unless you untick **Include legend in export**.

### Modes and guides

**Detailed** (the default) shows type tags, notes, use-case buses, ownership links and the composition root. **Overview** keeps names and the main flow only; a port becomes a notch on the ring with its name written beside it, and the rings shrink to fit. **Guides** draws the dashed spokes between the hexagon's corners, and **Highlight** turns the layer hover and the dependency chain on and off. All of these are remembered, and exports use whatever is on screen. On narrower screens the toolbar folds these controls into a **View** menu and the exports into an **Export** menu.

The **Appearance** menu (the moon or sun at the end of the toolbar) switches between light, dark and your system's theme, and offers two alternative palettes, Ink and Moss, if you'd rather not draw in indigo and rust. Both are remembered in this browser, and exports use the palette on screen.

### Layer hover

Hovering a ring or an element, or tabbing to it, brightens that layer and dims the rest. Esc or leaving the canvas clears it, and exports never carry it. With **Highlight** off the dimming stops, but the **+** buttons still appear.

### Dependency chain

Select an element (an adapter, a port, a use case, a domain item, or an actor or external system) and everything it depends on stays at full strength, with thicker strokes, while the rest of the map dims. The chain follows the dependency rule toward the core: adapter, port, use case, domain. It never goes back outward, so selecting a port does not light up its adapter, and selecting a use case does not light up its ports.

When the chain reaches a driven port that is linked to another hexagon, the link and the port at its other end join it, even while that hexagon is drawn compact. On a compact hexagon the chain stops at the port; on a hexagon drawn in full it carries on inward to that hexagon's domain. It never leaves a core through another outbound port, so it always ends at a domain.

Click empty canvas or press Esc to clear it, or turn **Highlight** off. It is also off while you link, and exports never carry it.

### File format

A `.hexa` file is plain JSON, now on version 5 — versions 1 through 4 still open and are upgraded automatically. A file is saved as version 4 unless it needs 5, which only an Onion whose rings were added, removed or reordered does, so an older build still opens everything else. A Hexagonal file holds a map with one or more bounded contexts and hexagons; a single diagram is a map with one of each. The JSON Schema for this shape lives in `src/model/fixtures/v2.schema.json` (the map shape hasn't changed since v2, only the version number has). A minimal file:

```json
{
  "app": "domainrings",
  "version": 4,
  "kind": "hexagonal",
  "title": "Orders",
  "contexts": [{ "id": "c1" }],
  "hexagons": [
    {
      "id": "h1",
      "contextId": "c1",
      "cell": { "q": 0, "r": 0 },
      "title": "Orders",
      "domain": [{ "id": "d-order", "name": "Order", "type": "aggregate" }],
      "useCases": [{ "id": "uc-place", "name": "PlaceOrder" }],
      "ports": [
        { "id": "p-place", "name": "placeOrder", "side": "driving", "useCaseId": "uc-place" },
        { "id": "p-placed", "name": "OrderPlaced", "side": "driven", "wall": "ne", "useCaseId": "uc-place" }
      ],
      "adapters": [
        { "id": "a-http", "name": "orders.routes", "portId": "p-place" },
        { "id": "a-publisher", "name": "OrderPlacedPublisher", "portId": "p-placed" }
      ],
      "actors": [{ "id": "act-web", "name": "Web app", "adapterId": "a-http" }],
      "externals": []
    }
  ],
  "links": []
}
```

Ids must be unique, and every reference (`parentId`, `useCaseId`, `portId`, `adapterId`) must point at something that exists; import tells you exactly what is wrong when they do not. Version 1 and 2 files still open, including those marked `"app": "archviz"` from before the project was renamed — and if one carries a Clean or Onion `kind` from the old skin-switcher era, it opens as Hexagonal, since that switcher no longer exists. Version 3 files, saved after native Onion first shipped, keep their own kind (Hexagonal or Onion) as they were. Version 5 lets an Onion file hold any number of rings: two or more, innermost first, the first with role `domain` and the last `outer`. Each ring's `role` id is one of the four original roles or `ring-` followed by letters, digits, `-` or `_` for a ring you added. Version 4 files still open unchanged.

### Fonts

The app loads IBM Plex Sans and IBM Plex Mono from Google Fonts, and SVG and PNG exports embed them. Offline, exports fall back to the system fonts.

### Run it locally

You need Node 24 or newer.

```sh
npm ci
npm run dev        # http://localhost:5173
npm test           # vitest run
npm run typecheck  # tsc --noEmit
```

The model and its validation live in `src/model/schema.ts`, Hexagonal's own ring/label config in `src/model/kinds.ts`, and the layout engine for all three architectures in `src/layout/`.

## What is coming

Onion and Clean, each modelled as its own architecture rather than a skin over the hexagonal model, are here. What's coming next: the AI skill growing to read and write Onion and Clean, not just Hexagonal.

## License

MIT. Use it, change it, and draw well.
