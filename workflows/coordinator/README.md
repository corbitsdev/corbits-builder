# Coordinator

The project coordinator: the one agent a person talks to, whatever they want
built, changed, improved or written. It reads the project, works out what the
person wants and composes the installed plugins to get them there: specialists
do the work, checks prove it, and screens put each decision in front of the
person. It decides which action serves the request and what instruction that
action gets; the hub carries the decision out.

## Where it fits

This package only declares data. It imports `@intx/agent/authoring` and
`@intx/workflow/definition`, nothing else from Interchange. The
[hub's coordinator entry][entry] imports it, supplies the model, director and
tools, and builds it into the workflow each project deploys. Its tools are the
hub's and fixed; everything it can start is a plugin (`plugins/`), so a new
capability adds no tool:

- `discover`: finds plugins from the person's wording, with each specialist's
  actions, whether each can start now and what it needs if not, and the
  project's values.
- `execute`: starts a specialist's action, such as the coder's `change`, runs
  a check, or opens a screen, such as the writer's `approve`, and waits for the
  person's answer, which the hub records.
- `plan`: the only way the project's plan is set, from steps it writes or by
  taking up a ready-made plan such as `build-web-app`.
- `runs`: lists, waits on and stops the runs it started.
- `question`: asks the person in words; it is Interchange's and waits for the
  answer. A choice an action has a screen for goes through `execute` instead.
- `read_artifact`: the document list and each document; it writes none.
  `read_file` reads back a tool result that was cut short.

## Layout

- `src/prompt.ts`: the system prompt, plus an optional versioned
  calibration appended to it. It says what the coordinator is in charge of,
  the conversation and the choice of action, and that Builder does everything
  after; what it can find with `discover` stays out of it.
- `src/agent.ts`: `createCoordinatorAgent`, which requires an explicit
  provider and model and tags the agent with this package's version.
- `src/workflow.ts`: `createCoordinatorWorkflow`, one durable mail-triggered
  step that takes every message the project's conversation sends.

## Working on it

Prompt conventions are in [AGENTS.md][agents]. `bun run typecheck` and `bun run test` cover it, and
`bun run dev` runs it in a real project.

[entry]: https://github.com/corbitsdev/corbits-builder/blob/main/apps/hub/src/workflows/entries/coordinator.ts
[agents]: https://github.com/corbitsdev/corbits-builder/blob/main/AGENTS.md
