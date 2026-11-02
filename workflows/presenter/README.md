# Presenter

The package presenter: builds a slide deck and approval package for one audience
persona from the project's approved documents and filed design tokens.

## Where it fits

This package only declares data. It imports `@intx/agent/authoring` and
`@intx/workflow/definition` from Interchange. The
[hub's presenter entry][entry] imports it, supplies the model, director and
tools, and builds it into the workflow the [coordinator][coordinator] starts
with `deploy_presenter`. The presenter's tools are the hub's `write_deck`,
`check_deck`, `file_package`, `mail` and `read_skill`; it has no project read
tool, because its assignment carries the selected documents and design tokens
in full.

## Layout

- `src/prompt.ts`: the system prompt.
- `src/agent.ts`: `createPresenterAgent`, which requires an explicit provider
  and model.
- `src/workflow.ts`: `createPresenterWorkflow`, a bounded single-step workflow
  that runs once on its first message.
- `skills/presenting/`: the `presenting` skill (`SKILL.md`), covering the core
  deck rules and per-persona guidance (`ceo`, `cto`, `investor`, `client`,
  `end_user`).
- `src/skills.ts`: a Bun macro that inlines `skills/` when an agent bundle
  is built.

## Working on it

What a presentation should contain lives in its skill rather than the prompt;
prompt conventions are in [AGENTS.md][agents]. `bun run typecheck` and `bun run test` cover it, and `bun run dev` runs it in a
real project.

[entry]: https://github.com/corbitsdev/corbits-builder/blob/main/apps/hub/src/workflows/entries/presenter.ts
[coordinator]: https://github.com/corbitsdev/corbits-builder/tree/main/workflows/coordinator
[agents]: https://github.com/corbitsdev/corbits-builder/blob/main/AGENTS.md
