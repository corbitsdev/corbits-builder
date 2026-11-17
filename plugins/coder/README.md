# Coder

The coder: builds the project's code from its approved documents (and, for a
web app, its design) in a sandboxed workspace that starts as a working
starter project or, when no starter fits, empty, whatever kind of thing the
project is. A later change is a new run on the saved code.

## Where it fits

This folder is the whole coder plugin. Its `package.json` `builder` block
names its two actions, `build` and `change`, the agent the hub builds and
installs from its prompt and role (`agents`), and the starter module that
starts its runs (`starters`). Its `appStarters` names what a first build can start
from: `web-app` (`starter/`) and `bare` (`starters/bare/`); `web-app` is the
`legacyDefault`, the starter a project with code but no recorded starter, built
before projects recorded one, is taken to have started from. Every
coder is finished by `check-stack`, which runs the commands the project's
`CHECKS.txt` lists; each starter ships one, equal to its `checks`, and it
names only the project's own commands because the `builds` check runs it
where Builder's commands are not. A starter whose projects need one of
Builder's own checks lists it in `BUILDER-CHECKS.txt`, which `check-stack`
runs after `CHECKS.txt`: the web starter lists `check-app`, its browser
pass. `coder build` may name a
starter; the hub then saves it as `stack.starter`, with the starter's `checks`
as `stack.checks` (the commands the `builds` check runs, which `build` and
`change` may correct), and writes the starter's files onto the project's app
repository before the coder clones it. Without a starter the workspace starts
empty, the coder builds in whatever stack the task names, writes its own
`CHECKS.txt` and reports its lines as `stack.checks` itself. There is one
package, `coder`, and it knows no starter: what the project's code declares
(its setup command, and whether it serves a web app) reaches its workspace
through the hub's project scope, and its `install_packages` asks the person
unless they turned on installing any package without asking, which the hub
grants the run when its workspace starts; `install_planned_packages` installs
without asking only the packages an approved document's `## Packages` section
names, which the hub reads from the approved version for each call. The
[coordinator][coordinator] starts it with `execute`. Its tools are file edits and `run_shell`
in the workspace, `install_packages`, `install_planned_packages`, Exa search, `read_artifact`, `mail`,
`app_status` and a headless browser.

## Layout

- `src/build/`, `src/change/`: one folder per action, whose `definition.ts`
  holds its input and how the coordinator fills it: its summary, when to use
  it and when not, and each field. `src/builds/definition.ts` says when to run
  the `builds` check, whose proof the manifest declares.
- `src/start.ts`: the starter module. It refuses while another coder works on
  the code, records a first build's starter for the hub to apply, and writes
  the run's assignment from the filed documents, the chosen design and the
  instruction.
- `prompt.md`: the system prompt, the same for every project. What a starter
  adds is in its `AGENTS.md` and, for the web-app starter, the
  `web-app-starter-skills` pack. The hub builds the agent from it and the
  role: a coder works in a workspace on a posix sidecar, and its reply waits
  until `check-stack` passes and then on the `builds` check.
- `src/contract.ts`: the documents a coder reads, the starters, and its
  assignment text.
- `starter/`: the starter app (Bun workspace with `client/`, `server/` and
  `packages/shared/`). Its `AGENTS.md` is the coder's guide to the app, and
  its placeholder `README.md` is what `check-app` requires the coder to
  replace.
- `starters/bare/`: the starter for anything that is not a web app: one
  TypeScript package on Bun with a test and no framework.

## Working on it

The starter pins `@corbits/react-ui` to the version the hub digests for the
workspace; the digest fails the bundle when they differ. The check scripts
(`check-app`, `check-stack`) are shipped into every coding workspace;
`check-stack` runs the commands in a project's `CHECKS.txt` and
`BUILDER-CHECKS.txt`. A defect in generated apps is fixed here, in the starter or prompt,
or in the hub's tools and check scripts. `bun run typecheck` and `bun run test` cover it, and `bun run dev`
runs it in a real project.

[coordinator]: https://github.com/corbitsdev/corbits-builder/tree/main/workflows/coordinator
