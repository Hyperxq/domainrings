# domainrings

Draw a Hexagonal, Onion or Clean architecture as a model; the layout is drawn for you. There is no free drag and drop, so the diagram always matches the model.

**Open it: https://diagrams.pbuilder.dev/** (runs in the browser, no account).

## Quick start

1. Open the app. It starts with a small Hexagonal example (**Chat feedback slice**).
2. In **Edit** mode, open **File → Start from an example** and pick one. Each architecture has a basic, a stress and an advanced example.
3. Switch **Overview** (for slides) and **Detailed** (for design reviews) in the toolbar.
4. Hover a ring and click a **+** to add something. Double-click an element to edit its name in the editor.
5. Switch to **View** to read the map without editing it by accident. The **Flows** panel appears there.
6. Keep or share it: **File → Save .hexa**, **Share → Download PNG / SVG**, or **Share → Copy link**.

## Core actions

| To | Do this |
|---|---|
| Start a new map | **File → New**, then choose Hexagonal, Onion or Clean. The choice is fixed for that file. |
| Add | Hover a ring, click **+**. Domain items ask for the type first. A name field opens: Enter keeps, Esc removes. |
| Rename | Double-click the element; the editor opens on its name. |
| Link | Select an element, then click **Link to…** (Hexagonal) or **Depend on…** (Onion, Clean), or press **L**. Esc leaves link mode. |
| Delete | Select, then Delete or Backspace. |
| Undo | **Undo** on the message that appears, or Ctrl+Z / Cmd+Z. |
| Open / save | **File → Open .hexa…** (Ctrl/Cmd+O), **File → Save .hexa** (Ctrl/Cmd+S). |
| Export image | **Share → Download PNG**, **Download SVG**, or **Copy image** (Ctrl/Cmd+C). |
| Share | **Share → Copy link**: the link contains the whole map. |
| Theme, palette | **View options** (sliders icon): Light / Dark / System, and the palettes. Exports use what is on screen. |

Other **View options** switches: Corridor guides, Dim other flows on hover, Dependents, Legend in exports, Planned (shown only when the map has planned items).

Select an element to see what it depends on. Turn on **Dependents** to see what depends on it instead.

## Flows

A flow is one use case, end to end. In **View** mode:

- The **Flows** panel lists every use case. Hover a row to preview its flow; click it to focus it, click again to clear. **All flows** resets.
- **Present** walks through the focused flow step by step: **Next** / **Back**, the arrow keys, Esc to exit.

## Honeycomb (Hexagonal only)

A map can hold several hexagons grouped into bounded contexts.

- Click the **+** on a free side of the current hexagon: **Hexagon in {context}** or **Hexagon in a new bounded context**.
- The editor's **Map** section has **Add subdomain from file…** to bring in another `.hexa`.
- Link a driven port of one hexagon to a driving port of another with **Link to…**. Links across contexts can carry a DDD relationship (`acl`, `ohs-pl`, `customer-supplier`, `conformist`, `shared-kernel`).
- Use the diagram menu next to the logo to switch hexagons or show the **Map of all contexts**. With **Only the current hexagon** under **Share → Export image**, an export covers just that hexagon.

## Command line

Needs Node 18+. Details and all flags: [cli/README.md](cli/README.md).

```sh
# Print a share link for a map; open it with one flow focused
npx @pbuilder/domainrings link map.hexa
npx @pbuilder/domainrings link map.hexa --flow PlaceOrder --open

# One image per flow (needs Chrome, or: npx playwright install chromium)
npx @pbuilder/domainrings render map.hexa --flow all --out docs/flows
npx @pbuilder/domainrings render map.hexa --flow PlaceOrder --format svg --palette cool --theme light
```

`--palette` takes `default`, `purple`, `terracotta` or `cool`; `--theme` takes `dark` or `light`.

## AI assistant skill

```sh
npx skills add Hyperxq/domainrings --skill domainrings
```

Your assistant then reads your code, writes the Hexagonal `.hexa` map, opens it through `npx @pbuilder/domainrings`, and can export an image per flow. Onion and Clean are not authored by the skill yet. See [skills/domainrings/SKILL.md](skills/domainrings/SKILL.md).

## File format

A `.hexa` file is plain JSON (`app`, `version`, `kind`, `title`, then `contexts`, `hexagons` and `links` for Hexagonal). The JSON Schema for the Hexagonal map is [src/model/fixtures/v2.schema.json](src/model/fixtures/v2.schema.json); working files are in [src/examples/](src/examples/). The app tells you exactly what is wrong when it refuses a file.

## Run locally

Node 24 or newer.

```sh
npm ci
npm run dev        # http://localhost:5173
npm test
npm run typecheck
```

## License

MIT.
