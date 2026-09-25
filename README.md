# domainrings

Draw your hexagonal architecture as a model, and let the rings lay themselves out.

Welcome, dear software craftsman. If you are here, you are probably learning Domain-Driven Design or putting it to work in a real codebase, and you know how hard it is to keep the picture in your head and the picture on the whiteboard in agreement. I hope this tool helps you with that.

domainrings turns a structured model (domain items, use cases, ports, adapters, actors and external systems) into a clean diagram of hexagonal, clean or onion architecture. You describe what exists and how it connects; the layout, the arrows and the rings are drawn for you. There is no free drag and drop, so the diagram always says exactly what the model says.

Open it at **https://diagrams.pbuilder.dev/**. It runs in your browser and saves as you go.

## Start here

1. Open the app. The first time, you see the **Chat feedback slice** example: one feature, drawn end to end.
2. Use **Example** in the toolbar to load another one:
   - **Chat feedback slice**: a single use case with its driving port, three driven ports, and the adapters, actors and external systems around them.
   - **Stress test**: two aggregates, three use cases and ports on every wall, to show how the layout grows.
   - **Two slices, one link**: two hexagons joined by one link, a small honeycomb, ready to grow.
3. Try three things:
   - Switch between **Overview** and **Detailed**. Overview is the version for a slide; Detailed is the version for a design review.
   - Hover a ring. Its layer lights up and everything else steps back, which is a quick way to ask "what lives in the application layer?"
   - While a ring is highlighted, click one of the **+** buttons that appear on it. That is how you add things.
4. Keep your work: **Export → .hexa** saves the model as a file you can open again later with **Open…**. **Export → SVG** or **PNG** gives you an image for documents and slides.

## Read the diagram

Everything in the diagram maps to a concept you use in code. From the centre outwards:

**The domain ring.** The solid ring at the centre holds the heart of your business logic. An **aggregate** is a consistency boundary: it is drawn with its entities and value objects listed under it, inside a thin outline tagged "aggregate". An **entity** has identity that lasts over time; a **value object** is defined only by its values; a **domain service** holds a rule that belongs to no single object. Nothing inside this ring points outwards.

**Use cases.** The application ring around the domain holds the use cases, one per business action (`PlaceOrder`, `CancelOrder`). Each use case sends one arrow into the domain, labelled "asks the domain to decide": the use case orchestrates, the domain decides.

**Ports.** A port is a contract, so it is drawn dashed on the edge of the application ring. A **driving** port (left half) is how the world asks your application to do something: an HTTP command, a queue event. A **driven** port (right half) is something your application needs from the world: a repository, a notifier, a clock.

**Driven ports inside the domain.** In the hexagonal skin the domain lists its driven ports under `driven-ports/`, and a dotted line joins each one to its socket on the wall. That is dependency inversion made visible: the domain declares the interface it needs, and the outside implements it.

**Adapters.** An adapter is the concrete code that plugs into a port, drawn solid in the outer ring. On the driving side it translates a request into a command (`orders.routes`); on the driven side it implements the contract with real technology (`KnexFeedbackRepository`).

**Actors and external systems.** Outside everything sit the things you do not own. An **actor** drives an adapter (a frontend, an admin); an **external system** is what a driven adapter talks to (Postgres, Mailgun, a legacy module).

**Three skins, one model.** The toolbar switches between **Hexagonal**, **Clean** and **Onion**. They draw the same model with each style's own words: Hexagonal has Infrastructure, Application and Domain rings; Clean has Frameworks & Drivers, Interface Adapters, Use Cases and Entities, and calls ports input and output ports; Onion has Infrastructure, Application Services, Domain Services and Domain Model. Switching skins never changes your model.

## Draw your own system

Start with **New** in the toolbar, or edit an example.

- **Add.** Hover a ring and click a **+**: a domain root or an item inside one (a small menu asks aggregate or entity for a root, entity or value object for an item inside), a use case, a port on any wall, an adapter for a port, or an actor or external system for an adapter. A name field opens on the new element: Enter keeps it, Esc removes it. The editor panel on the side has an add button in every section too.
- **Rename.** Double-click any element. The editor opens at its card with the name selected, ready to type over. Double-clicking a ring's title takes you to that layer under **Layers**, where you can change its title and subtitle. With the keyboard, Tab to an element and press Enter.
- **Link.** Click an element to select it. If it can be linked, a **Link to…** chip appears at its corner (or press **L**). The valid targets light up; click one. A port links to a use case, an adapter to a port, an actor or external system to an adapter, and an entity or value object to the aggregate or entity it belongs to. Esc leaves link mode.
- **Move ports between walls.** In the hexagonal skin a port can sit on any wall of its half: north-west, west or south-west for driving ports, north-east, east or south-east for driven ones. Pick the **Wall** in the port's card, or add it straight onto a wall with that wall's **+**. Clean and Onion keep ports in their left and right columns.
- **Seat a use case on a wall.** A use case normally stacks under the Application title. Its **Placement** can name a wall instead, and it moves into that wall's sector, next to the ports it serves.
- **Delete.** Select an element and press Delete or Backspace, or use the remove button on its card.
- **Undo.** Deleting, linking, starting a new diagram, loading an example and importing a file all show a short message with an **Undo** button; Ctrl+Z (Cmd+Z on a Mac) does the same while it is visible.

Your work autosaves in this browser's `localStorage` a moment after each change, so a reload brings it back. Export a `.hexa` file for anything you want to keep or share, and open it again with **Open…**.

## Build a honeycomb

A real system is rarely one slice. domainrings draws several hexagons side by side, each one its own diagram, none of them overlapping: a honeycomb you build by growing the map or bringing in slices you already have as files.

- **Grow.** The current hexagon's free sides show a **+**. Click one and choose **Hexagon in {context}** to add a neighbour in the same bounded context, or **Hexagon in a new bounded context** to start a fresh one. The new hexagon appears empty and current, with its title field open: type a name and press Enter, or Esc to undo the whole thing. The Hexagon section of the editor has its own **Add hexagon** button for the same move without touching the canvas.
- **Bring in a file.** The editor's Map section has **Add hexagon from file…**. It asks where the hexagon should land (**Import into {context}** or **Import into a new bounded context**) before you pick the file, so choose the destination first. The file must hold exactly one hexagon; a file with more is refused, with a message pointing you at **Open…** instead, which replaces the whole map. If the map you're adding to is still Clean or Onion, you're asked to confirm converting it to hexagonal, and the conversion and the add happen together as one undoable step.
- **Bounded contexts.** Once a map holds two or more contexts, each one is drawn as a dashed outline with a name chip, even when a context's hexagons aren't all next to each other, or when another context's hexagon sits in the middle of it. Name or rename a context in the editor's **Bounded contexts** section; an unnamed one shows a stable "Context {n}" placeholder that never changes while the context exists. A single-context map draws with no outlines at all, exactly as a lone hexagon always has.
- **Delete.** The Hexagon section's **Delete hexagon** removes the current hexagon, short of the very last one on the map; its links go with it, and its bounded context too if that hexagon was the only one in it. Undo brings all of it back in one step.
- **Fit to screen.** The zoom controls' **Fit to screen** button shows every hexagon on the map, however far it has grown, at whatever zoom that takes. Growing, importing or deleting a hexagon re-fits the view to the whole map automatically, unless a zoomed-in view already covers the change, which then stays exactly where it is.
- **Export scope.** Once a map holds more than one hexagon, Export offers a scope: **Map** exports everything (every hexagon, every link, every context's outline and chip), **Hexagon** exports just the current one, framed to its own bounds.

## Reference

### Visual language

Each meaning has one channel, and a collapsible legend in the bottom-right corner lists them:

- **Colour = layer or side:** indigo for the driving side, rust for the driven side, teal for the application ring and a solid teal domain, slate for the outer ring and external systems.
- **Stroke = role:** dashed for contracts (ports), solid for implementations (adapters, use cases), dotted for wiring and ownership.
- **Glyph + word = type:** `◆ aggregate`, `● entity`, `○ value object`, `⚙ domain service`, `▶ use case`, `⇥` for the driving side and `⇤` for the driven side, with each skin's own port and adapter words.

The legend shows only the types your diagram uses, and it is drawn into SVG and PNG exports unless you untick **Include legend in export**.

### Modes and guides

**Detailed** (the default) shows type tags, notes, use-case buses, ownership links and the composition root. **Overview** keeps names and the main flow only; a port becomes a notch on the ring with its name written beside it, and the rings shrink to fit. **Guides** draws the dashed spokes between the hexagon's corners, and **Highlight** turns the layer hover on and off. All of these are remembered, and exports use whatever is on screen. On narrower screens the toolbar folds these controls into a **View** menu and the exports into an **Export** menu.

The **Appearance** menu (the moon or sun at the end of the toolbar) switches between light, dark and your system's theme, and offers two alternative palettes, Ink and Moss, if you'd rather not draw in indigo and rust. Both are remembered in this browser, and exports use the palette on screen.

### Layer hover

Hovering a ring or an element, or tabbing to it, brightens that layer and dims the rest. Esc or leaving the canvas clears it, and exports never carry it. With **Highlight** off the dimming stops, but the **+** buttons still appear.

### File format

A `.hexa` file is plain JSON, version 2. It holds a map with one or more bounded contexts and hexagons; a single diagram is a map with one of each. The JSON Schema lives in `src/model/fixtures/v2.schema.json`. A minimal file:

```json
{
  "app": "domainrings",
  "version": 2,
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

Ids must be unique, and every reference (`parentId`, `useCaseId`, `portId`, `adapterId`) must point at something that exists; import tells you exactly what is wrong when they do not. Version 1 files still open, including those marked `"app": "archviz"` from before the project was renamed.

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

The model and its validation live in `src/model/schema.ts`, the three skins in `src/model/kinds.ts`, and the layout engine in `src/layout/`.

## What is coming

The honeycomb itself is here: grow a map from any hexagon, bring in slices you already have as files, and see the bounded contexts they belong to. What's still coming is the connective tissue between hexagons: links routed through their ports and labelled with the DDD relationship they represent (anticorruption layer, open host service, customer-supplier, conformist, shared kernel), so a context map can show not just where each slice lives, but how they depend on each other. The file format already has room for it.

## License

MIT. Use it, change it, and draw well.
