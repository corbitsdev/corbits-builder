# Tools hub

`@corbits-builder/tools-hub`: the helpers agent tools use to reach the
hub from inside a run. `workflowHttpJson` calls a hub route through the run's
mediated hub credential and throws `WorkflowHttpError` on a refusal,
`resolveWorkflowProjectScope` reads the project a run belongs to, and
`projectScopeCode` turns a failure into the only code the model sees.
`HubArtifactReceipt` checks a filing receipt while ignoring fields a newer
hub adds.

## Where it fits

Pure functions with no tool definitions and no runtime of their own. It
imports only [`packages/schemas`][schemas] and Interchange's types. The
[hub][hub]'s agent tools use it, and the workflow bundles carry it with
those tools.

## Layout

- `src/index.ts`: the package's exports.
- `src/http-json.ts`: `workflowHttpJson`, `mediatedHttpJson` and
  `WorkflowHttpError`.
- `src/artifact-receipt.ts`: `HubArtifactReceipt`.
- `src/project-scope.ts`: `resolveWorkflowProjectScope` and
  `projectScopeCode`.

## Working on it

Refusal bodies never reach the model; keep any new field to a public code.
`bun run typecheck` checks every importer and `bun run test` runs the tests.

[hub]: https://github.com/corbitsdev/corbits-builder/tree/main/apps/hub
[schemas]: https://github.com/corbitsdev/corbits-builder/tree/main/packages/schemas
