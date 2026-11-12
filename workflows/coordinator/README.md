# Coordinator

The project coordinator: the one agent a person talks to, whatever they want
built, changed, improved or written. It reads the project, works out what the
person wants and composes the installed plugins to get them there: specialists
do the work, checks prove it, and screens put each decision in front of the
person.

## Where it fits

This package only declares data. It imports `@intx/agent/authoring` and
`@intx/workflow/definition`, nothing else from Interchange. The
[hub's coordinator entry][entry] imports it, supplies the model, director and
tools, and builds it into the workflow each project deploys. The tools are
the hub's, and everything it can start is a plugin (`plugins/`):

- `discover`: finds plugins from the person's wording, with each specialist's
  actions, what each requires and whether the project has it now.
- `execute`: starts a specialist plugin's action, such as the coder's
  `change`, runs a check, or has the project follow a ready-made plan, such
  as `build-web-app`.
- `question`: opens a screen plugin, such as the writer's `approve`, or asks
  the person plainly. The hub records what a screen's answer approves.
- `runs`: lists, waits on and stops the runs it started.
- `plan`: keeps the project's plan, which shows the person where work of
  several steps stands.
- `read_artifact`: the document list and each document; it writes none.
  `read_file` reads back a tool result that was cut short.

## Layout

- `src/prompt.ts`: the system prompt, plus an optional versioned
  calibration appended to it. It reads the project and acts on what the
  person asks, letting each plugin's requirements order the work and fitting
  the work to the request rather than to a fixed path.
- `src/agent.ts`: `createCoordinatorAgent`, which requires an explicit
  provider and model and tags the agent with this package's version.
- `src/workflow.ts`: `createCoordinatorWorkflow`, one durable mail-triggered
  step that takes every message the project's conversation sends.

## Working on it

Prompt conventions are in [AGENTS.md][agents]. `bun run typecheck` and `bun run test` cover it, and
`bun run dev` runs it in a real project.

[entry]: https://github.com/corbitsdev/corbits-builder/blob/main/apps/hub/src/workflows/entries/coordinator.ts
[agents]: https://github.com/corbitsdev/corbits-builder/blob/main/AGENTS.md
