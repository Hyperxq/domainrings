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
