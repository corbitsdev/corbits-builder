# Tools artifacts

`@corbits-builder/tools-artifacts`: the tools agents use to read and write
a project's documents. The main export holds the logic as plain functions
a workflow action can call: `projectArtifacts` and `documentPart`.
`./sidecar-bundle` exports `createArtifactTools`, the `defineTool` bundle
behind `read_artifact` and `write_artifact`.

## Where it fits

It reaches the hub through [`packages/tools-hub`][tools-hub] and checks
what it gets with [`packages/schemas`][schemas]. The [hub][hub]'s
workflow entries attach the bundle, passing in the hub's `failure`, which
logs a failed call and returns the code the model sees, and, for the
coder, `unpackDesign`.

## Layout

- `src/index.ts`: the logic exports.
- `src/artifacts.ts`: `projectArtifacts` (list, read and write against the
  run's project) and `documentPart`, which splits a long document into
  parts that fit a tool result.
- `src/definitions.ts`: the tool definitions and their input schema.
- `src/sidecar-bundle.ts`: `createArtifactTools`, the bundle per role.

## Working on it

The bundle id is part of every grant name (`tool:<id>/<tool>`); keep it.
`bun run typecheck` checks every importer and `bun run test` runs the tests.

[hub]: https://github.com/corbitsdev/corbits-builder/tree/main/apps/hub
[schemas]: https://github.com/corbitsdev/corbits-builder/tree/main/packages/schemas
[tools-hub]: https://github.com/corbitsdev/corbits-builder/tree/main/packages/tools-hub
