# @pbuilder/domainrings

Command line for [domainrings](https://diagrams.pbuilder.dev) maps (`.hexa` files).

## link

```sh
npx @pbuilder/domainrings link map.hexa
npx @pbuilder/domainrings link map.hexa --flow PlaceOrder --open
```

Prints a share link. `--flow` takes a use case id or name (hexagonal maps only) and opens the map with that flow
focused; add `--hex <hexagonId>` when the same flow exists in several hexagons. `--open` also opens the link in the
default browser. `--base-url` points at another deployment, for example `http://localhost:5173/`.

## render

```sh
npx @pbuilder/domainrings render map.hexa --flow all --out docs/flows
npx @pbuilder/domainrings render map.hexa --flow PlaceOrder --format svg
```

Writes one image per flow by driving the app's own export in headless Chrome (`playwright-core`). `--flow all`
renders every use case of every hexagon; without `--flow` it renders the whole map. Files are named
`<hexagon>-<use-case>.<ext>` (or `<map-title>.<ext>`) in `--out` (default: the current directory). If Chrome is
not installed and no bundled chromium is found, run `npx playwright install chromium`.
