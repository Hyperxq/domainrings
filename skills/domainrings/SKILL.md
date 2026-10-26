---
name: domainrings
description: Draw a codebase's hexagonal architecture (ports and adapters) as a domainrings map, open it in the browser at diagrams.pbuilder.dev, and export an image per flow (PNG) for a PR or docs. Covers a single hexagon and a honeycomb of several hexagons across bounded contexts, with links between them. The link script also shares Onion and Clean files. Use when the user asks to draw, diagram, visualize, map or represent their hexagon, hexagonal architecture, ports and adapters, bounded contexts or context map, to open or highlight one use case's flow, to export a flow as an image or PNG or a diagram for a PR, or asks for a domainrings / .hexa file.
---

# domainrings

domainrings (https://diagrams.pbuilder.dev/) draws a hexagonal architecture from a JSON model, a `.hexa` file. You never lay anything out: you describe what exists and how it connects, and the app draws the rings, walls and arrows. Your job is to read the user's code, write that JSON, and give back a link that opens it. domainrings holds three kinds of architecture map, each a `.hexa` file with its own `kind`: `hexagonal`, `onion` and `clean`. This skill teaches you to write hexagonal maps. Onion and Clean files (for example the ones in the app's Examples menu, or exported from the app) are not authored here, but the link tools turn any of the three into a link, and the link opens the right kind.

## Workflow

1. **Find the slices.** One hexagon per slice of the system with its own use cases (a module, a service, a feature folder). Group hexagons into bounded contexts. One slice → one hexagon, one context.
2. **Map the code** of each slice onto the concepts below. Use the real names from the code. Never invent parts the code does not have; if something is only implied, say so in a `note`.
3. **Write the `.hexa` file** following the format and rules below. Start from `references/single-hexagon.hexa` or `references/honeycomb.hexa`.
4. **Check it** against the rules checklist. The link does not validate: the app refuses an invalid map when it opens.
5. **Open the map.** Run `npx -y @pbuilder/domainrings link <file.hexa> [--flow <id|name>] [--hex <id>] --open`. It prints a short link (`https://diagrams.pbuilder.dev/#s=<id>,<key>`) and opens the browser, view-only and in Overview. The map is stored encrypted; the key is only in the link. If the share store is unreachable, the command prints the full `#m=` link instead and says so on stderr; `--full` forces the full link. `--flow` opens the map with one use case's flow highlighted; it takes the use case id or name, and `--hex <hexagonId>` picks the hexagon when several have that flow. An unknown flow opens the map normally. It accepts hexagonal, onion and clean files (`--flow` is hexagonal only). Give the user the printed link too.
6. **Make images for a PR or docs.** Run `npx -y @pbuilder/domainrings render <file.hexa> --flow <id|name|all> [--out dir] [--format png|svg] [--palette default|purple|terracotta|cool] [--theme dark|light]`. It writes one image per flow (`all` = every use case); without `--flow` it renders the whole map. Defaults are purple and dark. It needs Chrome installed, or run `npx playwright install chromium` first. Commit the images or attach them to the PR.
7. **Offline fallback.** With no network, or no npx, run `node <this skill>/scripts/share-link.mjs <file.hexa>` (Node 16+, no dependencies). It prints `https://diagrams.pbuilder.dev/#m=…` without opening it or selecting a flow. Add `--view detailed` to start in the Detailed view instead (the link then ends in `&view=detailed`).
8. **When there is no link.** If you cannot run Node, or the printed link is a full `#m=` link over 8000 characters (the store was unreachable, or the map is over its 48 KB cap), give the user the `.hexa` file. A short `#s=` link has no length problem, whatever the map's size. They open it with **Open…** in the app's toolbar. Another option: the app also loads `https://diagrams.pbuilder.dev/?src=<https URL of a .hexa file>`, for example a raw GitHub gist. It also opens view-only in Overview; append `&view=detailed` for the Detailed view.

## From code to concepts

| Concept | What it is in code | JSON |
|---|---|---|
| Aggregate | Consistency boundary, the root the repository loads and saves | `domain[]`, `type: "aggregate"` |
| Entity | Has identity that lasts over time | `domain[]`, `type: "entity"` |
| Value object | Defined only by its values, immutable (`Money`, `Email`) | `domain[]`, `type: "valueObject"` |
| Domain service | A domain rule that belongs to no single object | `domain[]`, `type: "domainService"` |
| Use case | One business action: application service, command handler, interactor (`PlaceOrder`) | `useCases[]` |
| Driving port | How the world asks the app to act: the use case's input interface or command | `ports[]`, `side: "driving"` |
| Driven port | What the app needs from the world: repository interface, notifier, clock, gateway | `ports[]`, `side: "driven"` |
| Adapter | Concrete code plugged into a port: HTTP route, queue consumer, `KnexOrderRepository` | `adapters[]`, `portId` |
| Actor | Someone or something outside that drives a driving adapter: frontend, admin, cron | `actors[]`, `adapterId` |
| External system | What a driven adapter talks to: Postgres, Stripe, a legacy module | `externals[]`, `adapterId` |
| Composition root | Where adapters are wired into use cases (`main.ts`, DI container) | `composition` |

Hints:
- An interface the domain or application declares and infrastructure implements is a **driven port**. Its implementation is an **adapter**.
- A controller or route is a **driving adapter**. The method or command it calls on the application is the **driving port**.
- Entities and value objects that live inside an aggregate get `parentId` pointing at it. Nesting under an entity works the same way.
- Keep names short: the class or function name, not the file path.

## Format

```jsonc
{
  "app": "domainrings",          // always this
  "version": 5,                  // 2 to 5 all work; write 5, the current version
  "kind": "hexagonal",           // "onion" and "clean" are valid kinds too, but with a different body; this format is hexagonal
  "title": "Shop",               // the map's title
  "contexts": [{ "id": "c1", "name": "Sales" }],   // at least one; name optional
  "hexagons": [ /* at least one, see below */ ],
  "links": []                    // links between hexagons; [] for a single hexagon
}
```

Each hexagon:

```jsonc
{
  "id": "h1", "contextId": "c1",
  "cell": { "q": 0, "r": 0 },    // position in the honeycomb grid, see Honeycomb
  "title": "Orders", "subtitle": "optional one-liner",
  "domain":    [{ "id": "d-order", "name": "Order", "type": "aggregate", "parentId": "…optional" }],
  "useCases":  [{ "id": "uc-place", "name": "PlaceOrder", "placement": "top" }],
  "ports":     [{ "id": "p-place", "name": "placeOrder", "side": "driving", "wall": "w", "useCaseId": "uc-place" }],
  "adapters":  [{ "id": "a-http", "name": "orders.routes", "portId": "p-place" }],
  "actors":    [{ "id": "act-web", "name": "Web shop", "adapterId": "a-http" }],
  "externals": [{ "id": "ext-pg", "name": "Postgres", "adapterId": "a-repo" }],
  "composition": { "name": "composition.ts" },      // optional
  "layers": { "application": { "title": "App", "subtitle": "…" } }  // optional ring label overrides
}
```

- All six arrays are required, even when empty.
- Every item in them may carry a `note` (free text, `\n` for a new line). Use it for what the name cannot say.
- Optional fields:
  - `wall` (ports): which wall of the hexagon the port sits on. `nw`, `w`, `sw` are the driving half; `ne`, `e`, `se` the driven half. It defaults to `w` (driving) or `e` (driven). Spread ports across walls when a hexagon has many.
  - `useCaseId` (ports): the use case the port belongs to. It is valid on driven ports too: the use case calls the port. A port with none floats unconnected.
  - `useCaseIds` (ports): the use cases of a port shared by several, such as a clock or a report channel. List every one, e.g. `{ "id": "p-clock", "name": "Clock", "side": "driven", "useCaseIds": ["uc-assign", "uc-track"] }`. Each use case then draws its own line to the port in its own colour, and the port appears in each flow. Use `useCaseId` when only one use case calls the port.
  - `placement` (use cases): `top` (the default) stacks the use case under the Application title. A wall name seats it in that wall's sector, next to the ports it serves.
  - `layers` keys: `outer`, `adapters`, `application`, `domainServices`, `domain`.
- Id convention: `h1`/`c1`/`link1` for map-level ids, prefixed slugs inside a hexagon (`d-`, `uc-`, `p-`, `a-`, `act-`, `ext-`). It is only a convention; what the app requires is uniqueness.

## Honeycomb

Several hexagons on one map, grouped by bounded context. With two or more contexts, each is drawn as a dashed outline with its name.

- **Cells** use axial coordinates on a pointy-top grid. From `{q, r}`, the six neighbours are:
  - east `(q+1, r)`, west `(q-1, r)`;
  - north-east `(q+1, r-1)`, north-west `(q, r-1)`;
  - south-east `(q, r+1)`, south-west `(q-1, r+1)`.

  Put hexagons of the same context next to each other and start at `(0, 0)`. No two hexagons may share a cell.
- **Links** join a port on one hexagon to a port on another. They mean "`from` depends on `to`":
  ```json
  { "id": "link1",
    "from": { "hexagonId": "h1", "portId": "p-ship",    "adapterId": "a-ship" },
    "to":   { "hexagonId": "h3", "portId": "p-request", "adapterId": "a-request" },
    "pattern": "acl" }
  ```
  - `from` is a **driven** port: the hexagon that needs something.
  - `to` is a **driving** port: the hexagon that provides it.
  - `adapterId` is optional on either end. When set, it must be an adapter attached to that end's port.
- **Patterns** label the DDD relationship. They are allowed **only when the two hexagons are in different contexts**:

  | Value | Meaning |
  |---|---|
  | `acl` | Anticorruption layer: `from` translates `to`'s model into its own |
  | `ohs-pl` | Open host service / published language: `to` offers a public protocol |
  | `customer-supplier` | `to` (the supplier) plans around `from`'s (the customer's) needs |
  | `conformist` | `from` adopts `to`'s model as it is |
  | `shared-kernel` | Both share a small part of the model |

  Leave `pattern` out when the relationship is not evident from the code.

## Rules checklist

The app rejects the map if any of these fail:

- [ ] `app` is `"domainrings"`, `version` is `2`, `3`, `4` or `5`, `kind` is `"hexagonal"` (for a hexagonal file you write).
- [ ] Ids are unique: contexts, hexagons and links across the map; each collection within its own hexagon.
- [ ] Every reference points at something that exists **in the same hexagon**: `parentId` → `domain`, `useCaseId` and every `useCaseIds` entry → `useCases`, `portId` → `ports`, `adapterId` → `adapters`. Every hexagon's `contextId` → `contexts`.
- [ ] `parentId` points at an `aggregate` or an `entity`, never at a value object or domain service, and never forms a cycle.
- [ ] A port's `wall` is on its own side's half.
- [ ] No two hexagons share a `cell`.
- [ ] Links:
  - `from` is a driven port and `to` is a driving port;
  - the two ends are on different hexagons;
  - no two links join the same pair of ports;
  - an end's `adapterId`, if present, is on that end's port;
  - `pattern`, if present, is one of the five values and the link crosses contexts.

Not enforced, but expected: every context holds at least one hexagon.

## References

- `references/single-hexagon.hexa`: one slice, end to end. It shows nesting, a domain service, walls, notes and the composition root.
- `references/honeycomb.hexa`: two contexts, three hexagons. It has a same-context link with no pattern and a cross-context `acl` link.
- The full JSON Schema is in the domainrings repo: `src/model/fixtures/v2.schema.json` (https://github.com/Hyperxq/domainrings).
