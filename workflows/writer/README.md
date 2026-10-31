# Writer

The document writer: writes one project document per run, either constraints,
approaches, product requirements or the build plan, from the documents the
coordinator hands it.

## Where it fits

This package only declares data. It imports `@intx/agent/authoring` and
`@intx/workflow/definition` from Interchange, plus arktype. The
[hub's writer entry][entry] imports it, supplies the model, director and
tools, and builds it into the workflow the [coordinator][coordinator] starts
with `deploy_writer`. The writer's tools are the hub's `write_artifact` and
`read_skill`; it has no read tool, because its task carries every document it
needs in full.

## Layout

- `src/prompt.ts`: the system prompt.
- `src/agent.ts`: `createWriterAgent`, which requires an explicit provider
  and model.
- `src/workflow.ts`: `createWriterWorkflow`, a bounded single-step workflow
  that runs once on its first message.
- `src/contract.ts`: `writerTaskMessage`, the schema-checked assignment the
  hub sends.
- `skills/`: one skill per document kind, each a `SKILL.md` and a reference
  exemplar, including the coordinator's problem-brief skill.
- `src/skills.ts`: a Bun macro that inlines `skills/` when an agent bundle
  is built.

## Working on it

What a document should contain lives in its skill rather than the prompt;
prompt conventions are in [AGENTS.md][agents]. `bun run check` typechecks
and tests it, and `bun run dev` runs it in a real project.

[entry]: https://github.com/corbitsdev/corbits-builder/blob/main/apps/hub/src/workflows/entries/writer.ts
[coordinator]: https://github.com/corbitsdev/corbits-builder/tree/main/workflows/coordinator
[agents]: https://github.com/corbitsdev/corbits-builder/blob/main/AGENTS.md
