# Coordinator

The project coordinator: the one agent a person talks to. It interviews them,
writes the problem brief, hands each later document, the design and the build
to a specialist, and asks the person for every decision.

## Where it fits

This package only declares data. It imports `@intx/agent/authoring` and
`@intx/workflow/definition`, nothing else from Interchange. The
[hub's coordinator entry][entry] imports it, supplies the model, director and
tools, and builds it into the workflow each project deploys. The tools are
the hub's:

- `read_artifact`, `write_artifact`: the document list and the brief.
- `deploy_writer`, `design_app`, `deploy_coder`, `instruct_coder`: start or
  steer the [writer][writer], [designer][designer] and [coder][coder].
- `review_artifact`: a second opinion from the [reviewer][reviewer].
- `request_approval`, `ask_questions`: approval and question cards for the
  person.
- `read_skill`: the problem-brief skill from the writer package.

## Layout

- `src/prompt.ts`: the system prompt, plus an optional versioned
  calibration appended to it.
- `src/agent.ts`: `createCoordinatorAgent`, which requires an explicit
  provider and model and tags the agent with this package's version.
- `src/workflow.ts`: `createCoordinatorWorkflow`, one durable mail-triggered
  step that takes every message the project's conversation sends.

## Working on it

Prompt conventions are in [AGENTS.md][agents]. `bun run typecheck` and `bun run test` cover it, and
`bun run dev` runs it in a real project.

[entry]: https://github.com/corbitsdev/corbits-builder/blob/main/apps/hub/src/workflows/entries/coordinator.ts
[writer]: https://github.com/corbitsdev/corbits-builder/tree/main/workflows/writer
[designer]: https://github.com/corbitsdev/corbits-builder/tree/main/workflows/designer
[coder]: https://github.com/corbitsdev/corbits-builder/tree/main/workflows/coder
[reviewer]: https://github.com/corbitsdev/corbits-builder/tree/main/workflows/reviewer
[agents]: https://github.com/corbitsdev/corbits-builder/blob/main/AGENTS.md
