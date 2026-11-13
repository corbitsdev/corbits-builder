# Coder

The coder: builds the project's code from its approved documents (and, for a
web app, its design) in a sandboxed workspace that starts as a working
starter project or, when no starter fits, empty, whatever kind of thing the
project is. A later change is a new run on the saved code.

## Where it fits

This folder is the whole coder plugin. Its `package.json` `builder` block
names its two actions, `build` and `change`, the workflow packages the hub
builds and installs from it (`packages`), and the starter module that starts
its runs (`starters`). Its `coder.starters` block names what a first build can
start from: `web-app` (`starter/`, finished by `check-app`) and `bare`
(`starters/bare/`, finished by `check-project`). `coder build` may name a
starter; the first build records it as `stack.starter`, and a later
`coder change` starts the coder that fits it. The first build also records the
starter's `checks` as `stack.checks`, the commands the `builds` check runs in
order; `build` and `change` may correct them. Without a starter (`coder.empty`)
the workspace starts empty, the coder builds in whatever stack the task names,
keeps its checks in `CHECKS.txt`, is finished by `check-stack` and reports
them as `stack.checks` itself; a change to code with no `stack.starter` gets
this coder too. Each starter, and code with none, has two packages, one that
asks the person before installing a package and one (`-any-package`) that does
not: `coder`, `coder-any-package`, `coder-bare`, `coder-bare-any-package`,
`coder-empty` and `coder-empty-any-package`. The
[coordinator][coordinator] starts them with `execute`. Its tools are file edits and `run_shell`
in the workspace, `install_packages`, Exa search, `read_artifact`,
`read_skill` and `mail`, and for a web app `app_status` and a headless browser.

## Layout

- `src/build.ts`, `src/change.ts`: each action's input and how the
  coordinator fills it.
- `src/start.ts`: the starter module. It refuses while another coder works on
  the code, picks the package for the run's starter, and writes the run's
  assignment from the filed documents, the chosen design and the instruction.
- `src/package.ts`: `coderPackage`, which assembles the agent from the hub's
  model, director and tools for one starter, and asks the director to hold a
  reply until that starter's finish check passes. `src/packages/` holds one entry per installed package.
- `src/prompt.ts`: the system prompt: what any coding job asks, with each
  starter's own part.
- `src/agent.ts`: `createCoderAgent`, which requires an explicit provider
  and model and appends the hub's design standard to the prompt.
- `src/workflow.ts`: `createCoderWorkflow`, a mail-triggered step on a posix
  sidecar that takes one assignment and ends. A later change is a new run
  that clones the saved app.
- `src/contract.ts`: the documents a coder reads, the starters, and its
  assignment text.
- `starter/`: the starter app (Bun workspace with `client/`, `server/` and
  `packages/shared/`). Its `AGENTS.md` is the coder's guide to the app, and
  its placeholder `README.md` is what `check-app` requires the coder to
  replace.
- `starters/bare/`: the starter for anything that is not a web app: one
  TypeScript package on Bun with a test and no framework.
- `check/`: `check-app.ts`, which builds, starts and browses a web app (or a
  design mockup); `check-project.ts`, which runs a project's typecheck, test
  and build scripts; `check-stack.ts`, which runs the commands in a
  project's `CHECKS.txt`; `steps.ts`, the steps they share; and `watch-page.ts`,
  which reports page errors during a web app's build. They are shipped into
  the workspace.
- `src/assets.ts`: Bun macros that inline the starters, the check scripts and
  a digest of `@corbits/react-ui` when the hub is bundled.

## Working on it

The starter pins `@corbits/react-ui` to the same version as this package's
dependency; the digest fails the bundle when they differ. A defect in
generated apps is fixed here, in the starter, prompt or check scripts, or in
the hub's tools. `bun run typecheck` and `bun run test` cover it, and `bun run dev`
runs it in a real project.

[coordinator]: https://github.com/corbitsdev/corbits-builder/tree/main/workflows/coordinator
