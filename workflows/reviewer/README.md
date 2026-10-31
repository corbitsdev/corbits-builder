# Reviewer

The document reviewer: gives the coordinator a second opinion on one
document and mails back its findings, which the coordinator weighs as
advice.

## Where it fits

This package only declares data. It imports `@intx/agent/authoring` and
`@intx/workflow/definition`, nothing else from Interchange. The
[hub's reviewer entry][entry] imports it, supplies the model, director and
the `mail` tool, and builds it into the workflow the
[coordinator][coordinator] starts with `review_artifact`. The task carries
the problem brief and the document to review in full.

## Layout

- `src/prompt.ts`: the system prompt.
- `src/agent.ts`: `createReviewerAgent`, which requires an explicit
  provider and model.
- `src/workflow.ts`: `createReviewerWorkflow`, a bounded single-step
  workflow that runs once on its first message.

## Working on it

Prompt conventions are in [AGENTS.md][agents].
`bun run typecheck` and `bun run test` cover it, and `bun run dev` runs it in a
real project.

[entry]: https://github.com/corbitsdev/corbits-builder/blob/main/apps/hub/src/workflows/entries/reviewer.ts
[coordinator]: https://github.com/corbitsdev/corbits-builder/tree/main/workflows/coordinator
[agents]: https://github.com/corbitsdev/corbits-builder/blob/main/AGENTS.md
