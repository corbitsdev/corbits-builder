# Coder

The coder: builds the whole app from the project's approved documents and
design, in a sandboxed workspace that starts as a working starter app. A
later change is a new run on the saved app.

## Where it fits

This folder is the whole coder plugin. Its `package.json` `builder` block
names its two actions, `build` and `change`, the workflow packages the hub
builds and installs from it (`packages`), and the starter that starts its runs
(`starters`). The two packages are `coder`, which asks the person before
installing a package, and `coder-any-package`, which does not. The
[coordinator][coordinator] starts them with `execute`. Its tools are file edits and `run_shell`
in the app workspace, `install_packages`, `app_status`, a headless browser,
Exa search, `read_artifact`, `read_skill` and `mail`.

## Layout

- `src/build.ts`, `src/change.ts`: each action's input and how the
  coordinator fills it.
- `src/start.ts`: the starter. It refuses while another coder works on the
  app, and writes the run's assignment from the filed documents, the chosen
  design and the instruction.
- `src/package.ts`: `coderPackage`, which assembles the agent from the hub's
  model, director and tools, and asks the director to hold a reply until
  check-app passes. `src/packages/` holds one entry per installed package.
- `src/prompt.ts`: the system prompt.
- `src/agent.ts`: `createCoderAgent`, which requires an explicit provider
  and model and appends the hub's design standard to the prompt.
- `src/workflow.ts`: `createCoderWorkflow`, a mail-triggered step on a posix
  sidecar that takes one assignment and ends. A later change is a new run
  that clones the saved app.
- `src/contract.ts`: the documents a coder reads and its assignment text.
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
dependency; the digest fails the bundle when they differ. A defect in
generated apps is fixed here, in the starter, prompt or check scripts, or in
the hub's tools. `bun run typecheck` and `bun run test` cover it, and `bun run dev`
runs it in a real project.

[coordinator]: https://github.com/corbitsdev/corbits-builder/tree/main/workflows/coordinator
