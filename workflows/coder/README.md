# Coder

The coder: builds the whole app from the project's approved documents and
design, in a sandboxed workspace that starts as a working starter app, and
keeps taking change requests on the same app.

## Where it fits

This package only declares data. It imports `@intx/agent/authoring` and
`@intx/workflow/definition`, nothing else from Interchange. The hub's
[coder package][package] imports it, supplies the model, director and tools,
and builds two workflows from it: `coder`, which asks the person before
installing a package, and `coder-any-package`, which does not. The
[coordinator][coordinator] starts one with `deploy_coder` and steers it with
`instruct_coder`. Its tools are file edits and `run_shell` in the app
workspace, `install_packages`, `app_status`, a headless browser, Exa search,
`read_artifact`, `read_skill` and `mail`.

## Layout

- `src/prompt.ts`: the system prompt.
- `src/agent.ts`: `createCoderAgent`, which requires an explicit provider
  and model and appends the hub's design standard to the prompt.
- `src/workflow.ts`: `createCoderWorkflow`, a long-lived mail-triggered step
  on a posix sidecar; each message is another assignment on the same warm
  workspace.
- `src/contract.ts`: `coderTaskMessage`, the assignment text.
- `starter/`: the starter app (Bun workspace with `client/`, `server/` and
  `packages/shared/`). Its `AGENTS.md` is the coder's guide to the app, and
  its placeholder `README.md` is what `check-app` requires the coder to
  replace.
- `check/`: `check-app.ts`, which builds, starts and browses the app (or a
  design mockup), and `watch-page.ts`, which reports page errors during the
  build. Both are shipped into the workspace.
- `src/assets.ts`: Bun macros that inline the starter, the check scripts and
  a digest of `@corbits/react-ui` when the hub is bundled.

## Working on it

The starter pins `@corbits/react-ui` to the same version as this package's
dev dependency; the digest fails the bundle when they differ. A defect in
generated apps is fixed here, in the starter, prompt or check scripts, or in
the hub's tools. `bun run typecheck` and `bun run test` cover it, and `bun run dev`
runs it in a real project.

[package]: https://github.com/corbitsdev/corbits-builder/blob/main/apps/hub/src/workflows/coder-package.ts
[coordinator]: https://github.com/corbitsdev/corbits-builder/tree/main/workflows/coordinator
