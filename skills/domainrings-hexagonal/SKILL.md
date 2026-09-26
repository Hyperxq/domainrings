---
name: domainrings-hexagonal
description: Draw a codebase's hexagonal architecture (ports and adapters) as a domainrings map and hand back a link that opens it in the browser at diagrams.pbuilder.dev. Covers a single hexagon and a honeycomb of several hexagons across bounded contexts, with links between them. Use when the user asks to draw, diagram, visualize, map or represent their hexagon, hexagonal architecture, ports and adapters, bounded contexts or context map, or asks for a domainrings / .hexa file.
---

# domainrings — hexagonal maps

domainrings (https://diagrams.pbuilder.dev/) draws a hexagonal architecture from a JSON model, a `.hexa` file. You never lay anything out: you describe what exists and how it connects, and the app draws the rings, walls and arrows. Your job is to read the user's code, write that JSON, and give back a link that opens it.

## Workflow

1. **Find the slices.** One hexagon per slice of the system with its own use cases (a module, a service, a feature folder). Group hexagons into bounded contexts. One slice → one hexagon, one context.
2. **Map the code** of each slice onto the concepts below. Use the real names from the code. Never invent parts the code does not have; if something is only implied, say so in a `note`.
3. **Write the `.hexa` file** following the format and rules below. Start from `references/single-hexagon.hexa` or `references/honeycomb.hexa`.
4. **Check it** against the rules checklist. The link does not validate: the app refuses an invalid map when it opens.
5. **Make the link.** Run `node <this skill>/scripts/share-link.mjs <file.hexa>` (Node 16+, no dependencies). It prints `https://diagrams.pbuilder.dev/#m=…`; give that to the user. Opening it loads the map straight away.
6. **When there is no link.** If you cannot run Node, or the script warns that the link is over 8000 characters, give the user the `.hexa` file. They open it with **Open…** in the app's toolbar. Another option: the app also loads `https://diagrams.pbuilder.dev/?src=<https URL of a .hexa file>`, for example a raw GitHub gist.

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
  "version": 2,                  // always 2
  "kind": "hexagonal",           // always "hexagonal" for this skill
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

- [ ] `app` is `"domainrings"`, `version` is `2`, `kind` is `"hexagonal"`.
- [ ] Ids are unique: contexts, hexagons and links across the map; each collection within its own hexagon.
- [ ] Every reference points at something that exists **in the same hexagon**: `parentId` → `domain`, `useCaseId` → `useCases`, `portId` → `ports`, `adapterId` → `adapters`. Every hexagon's `contextId` → `contexts`.
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
