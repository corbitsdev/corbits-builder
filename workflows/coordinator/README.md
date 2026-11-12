# Coordinator

The project coordinator: the one agent a person talks to. It reads the
project, works out what the person wants and starts the plugin actions that
get them there: writers, designers and coders do the work, and screens put
each decision in front of the person.

## Where it fits

This package only declares data. It imports `@intx/agent/authoring` and
`@intx/workflow/definition`, nothing else from Interchange. The
[hub's coordinator entry][entry] imports it, supplies the model, director and
tools, and builds it into the workflow each project deploys. The tools are
the hub's, and everything it can start is a plugin (`plugins/`):

- `discover`: finds plugins from the person's wording, with each specialist's
  actions, what each requires and whether the project has it now.
- `execute`: starts a specialist plugin's action, such as the coder's
  `change`, or puts the project on a route plugin, such as `build-web-app`.
- `question`: opens a screen plugin, such as the writer's `approve`, or asks
  the person plainly. The hub records what a screen's answer approves.
- `read_artifact`: the document list and each document; it writes none.

## Layout

- `src/prompt.ts`: the system prompt, plus an optional versioned
  calibration appended to it. It reads the project and acts on what the
  person asks, letting each plugin's requirements order the work.
- `src/agent.ts`: `createCoordinatorAgent`, which requires an explicit
  provider and model and tags the agent with this package's version.
- `src/workflow.ts`: `createCoordinatorWorkflow`, one durable mail-triggered
  step that takes every message the project's conversation sends.

## Working on it

Prompt conventions are in [AGENTS.md][agents]. `bun run typecheck` and `bun run test` cover it, and
`bun run dev` runs it in a real project.

[entry]: https://github.com/corbitsdev/corbits-builder/blob/main/apps/hub/src/workflows/entries/coordinator.ts
[agents]: https://github.com/corbitsdev/corbits-builder/blob/main/AGENTS.md
