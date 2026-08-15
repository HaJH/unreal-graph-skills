# Third-party code

## bue-render — `vendor/bue-render.js`, `vendor/bue-render.css`

The renderer that draws the graph. It is the same one blueprintue.com runs, taken from
[blueprintue-self-hosted-edition](https://github.com/blueprintue/blueprintue-self-hosted-edition)
(`www/bue-render/`).

- **Licence:** MIT — full text in [`vendor/LICENSE.bue-render`](vendor/LICENSE.bue-render)
- **Copyright:** © 2023 blueprintUE

It is vendored rather than fetched because the pages this skill builds must run with no
network access at all: they are published as Claude Artifacts, where a strict CSP blocks every
external host. Both files are shipped byte-for-byte as published; only minified builds are
distributed upstream, so no unminified source exists to include.

Every asset inside the stylesheet is already a `data:` URI, which is why nothing else needs
bundling. `build.mjs` refuses to build if that ever stops being true.

## Fonts

None are bundled. The renderer asks for `Roboto, sans-serif`; hosts that already have Roboto
use it, and everywhere else falls back through the system stack. Earlier revisions inlined
Roboto — that was removed rather than carry a font binary of uncertain provenance.

## Not included

The pin encoding in [`reference/ENCODING.md`](reference/ENCODING.md) was derived by reading
Material Editor copies, some of which came from
[ueblueprint](https://github.com/barsdeveloper/ueblueprint)'s test fixtures (MIT, ©
barsdeveloper). Those files are **not** redistributed here — the document describes the format
in its own words, and `reference/survey.mjs` reads copies you make yourself.
