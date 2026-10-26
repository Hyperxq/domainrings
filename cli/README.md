# @pbuilder/domainrings

Command line for [domainrings](https://diagrams.pbuilder.dev) maps (`.hexa` files).

## link

```sh
npx @pbuilder/domainrings link map.hexa
npx @pbuilder/domainrings link map.hexa --flow PlaceOrder --open
npx @pbuilder/domainrings link map.hexa --full
```

Prints a short share link, `#s=<id>,<key>`, like the app's **Copy link**: the map is encrypted with AES-GCM on your
machine and only the ciphertext goes to the share store (`https://share.pbuilder.dev`); the key stays in the link's
fragment. If the store refuses the map, is down or does not answer within 5 seconds, the command prints the
self-contained `#m=` link instead and says why on stderr. `--full` always prints the `#m=` link and never contacts the
store, for offline use.

`--flow` takes a use case id or name (hexagonal maps only) and opens the map with that flow focused; add
`--hex <hexagonId>` when the same flow exists in several hexagons. `--open` also opens the link in the default browser.
`--base-url` points at another deployment, for example `http://localhost:5173/`. A short link only opens on a
deployment that reads the same store, so with `--base-url` pass that deployment's store as `--store <url>`; without
it the command prints the `#m=` link.

## render

```sh
npx @pbuilder/domainrings render map.hexa --flow all --out docs/flows
npx @pbuilder/domainrings render map.hexa --flow PlaceOrder --format svg
```

Writes one image per flow by driving the app's own export in headless Chrome (`playwright-core`). `--flow all`
renders every use case of every hexagon; without `--flow` it renders the whole map. A flow image is cropped to the
hexagons the flow touches, with the map links between them and the context hulls and chips as they appear on the map;
the other hexagons are left out. Files are named
`<hexagon>-<use-case>.<ext>` (or `<map-title>.<ext>`) in `--out` (default: the current directory). If Chrome is
not installed and no bundled chromium is found, run `npx playwright install chromium`.

`--palette <default|purple|terracotta|cool>` (default `purple`) and `--theme <dark|light>` (default `dark`) pick the
colours of the image, independent of the app's own saved preferences. An unknown value falls back to the default with
a warning. With `--flow all`, a failed flow is reported and the rest still render; the exit code is non-zero if any
failed, and `--hex <id>` limits `all` to that hexagon. Two flows that would get the same file name get a `-2`, `-3`
suffix.

## Releasing

Releases go out through the **Publish** workflow with npm trusted publishing (OIDC, provenance, no token). The
first version was published by hand.

1. Bump `version` in `cli/package.json` on a branch and merge it to `main`.
2. In the repository's Actions tab, run **Publish** on `main`.

The workflow refuses any other repository or ref, runs the root typecheck and tests, and fails when the version is
not valid semver or is already on the registry (`cli/scripts/validate-release.mjs`).
