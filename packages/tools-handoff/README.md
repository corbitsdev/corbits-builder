# Tools handoff

`@corbits-builder/tools-handoff`: the coordinator's hand-off tools.
`request_approval` and `ask_questions` go to the person; `deploy_writer`,
`review_artifact`, `deploy_coder`, `instruct_coder` and `design_app` hand
work to the specialists. Each tool's logic is a plain function a workflow
action can call; `./sidecar-bundle` is the `defineTool` bundle over them.

## Where it fits

The [hub][hub]'s coordinator workflow attaches `createDeployTools` from
`./sidecar-bundle` with a `HandoffConfig` built from the hub's config: the
wording, design concepts, preferences, assignment builders and the hub's
`failure`, which logs a failed project lookup and returns the code the
model sees. It reaches the hub through [`packages/tools-hub`][tools-hub]
and checks what it gets with [`packages/schemas`][schemas].

## Layout

- `src/index.ts`: the logic exports and `HandoffConfig`.
- `src/sidecar-bundle.ts`: `createDeployTools`, the `defineTool` bundle.
- `src/config.ts`: `HandoffConfig` and `HandoffScope`.
- `src/handoff.ts`: one function per tool.
- `src/definitions.ts`: the tool definitions and their input schemas.
- `src/project-hub.ts`: the project's hub routes and specialist deploys.
- `src/approvals.ts`: the approvable documents and `awaitingApproval`.
- `src/refusal.ts`: the refusals the model sees.

## Working on it

The bundle id `@corbits-builder/deploy/tools` is part of every grant name
(`tool:<id>/<tool>`); keep it. `bun run typecheck` checks every importer
and `bun run test` runs the tests.

[hub]: https://github.com/corbitsdev/corbits-builder/tree/main/apps/hub
[schemas]: https://github.com/corbitsdev/corbits-builder/tree/main/packages/schemas
[tools-hub]: https://github.com/corbitsdev/corbits-builder/tree/main/packages/tools-hub
