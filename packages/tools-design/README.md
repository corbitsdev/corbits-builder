# Tools design

`@corbits-builder/tools-design`: the designer's tools. `file_design_option`
files the designer's `.builder` folder as its design concept's option once
the design check (check-app on the mockup) passes, and `withDesignTokens`
writes the stylesheet's tokens into the filed `DESIGN.md`.

## Where it fits

The [hub][hub]'s designer workflow attaches `createDesignTools` from
`./sidecar-bundle` and passes the hub's `failure`, which logs a thrown error
and turns it into the code the model sees. The hub's coding tools register a
workspace's design check with `createDesignCheck`, and the filing tool waits
on it; both load into the one workflow bundle. It reaches the hub through
[`packages/tools-hub`][tools-hub].

## Layout

- `src/index.ts`: the logic exports.
- `src/sidecar-bundle.ts`: `createDesignTools`, the `defineTool` bundle.
- `src/file-design-option.ts`: the filing logic and its definition.
- `src/design-check.ts`: the design check and `check_design`'s definition.
- `src/design-tokens.ts` and `src/design-tweaks.ts`: the stylesheet tokens.

## Working on it

The bundle id `@corbits-builder/artifacts/design-tools` names the tools'
grants; keep it. `bun run typecheck` checks every importer and `bun run test`
runs the tests.

[hub]: https://github.com/corbitsdev/corbits-builder/tree/main/apps/hub
[tools-hub]: https://github.com/corbitsdev/corbits-builder/tree/main/packages/tools-hub
