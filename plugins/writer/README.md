# Writer

The project's documents: the writer writes one document per run, the reviewer
gives the coordinator a second opinion on one, and the approve screen puts
filed documents in front of the person.

## Where it fits

This folder is the whole writer plugin, with two agents. Its `package.json`
`builder` block names its actions (`write`, `write-requirements`,
`write-build-plan`, `review` and the `approve` screen), the workflow packages
the hub builds and installs from it (`packages`) and the starter of each
(`starters`). The writer is installed once per known document kind
(constraints, approaches, product requirements, build plan), whose
`write_artifact` saves only that kind's fields, and once as `writer-document`,
which writes any document under the kind its task names. The reviewer is the
`reviewer` package. The dynamic [coordinator][coordinator] starts them with
`execute`; the classic one with `deploy_writer` and `review_artifact`.

The writer's tools are the hub's `write_artifact` and `read_skill`; it has no
read tool, because its task carries every document it needs in full. The
reviewer has only `mail`: its task carries the problem brief and the document
to review, and the coordinator weighs its findings as advice.

## Layout

- `src/write.ts`, `src/write-requirements.ts`, `src/write-build-plan.ts`,
  `src/review.ts`: each action's input and how the coordinator fills it.
- `src/start.ts`, `src/start-document.ts`, `src/start-review.ts`: the
  starters of the per-kind writers, the writer of any document and the
  reviewer. Each writes its run's assignment from the filed documents.
- `src/task.ts`: the assignment both agents get, with every document it
  builds on read in full, and the default stack a build plan is written to;
  shared with the classic tools.
- `src/package.ts`: `writerPackage`, which assembles the writer from the hub's
  model, director and tools. `src/packages/` holds one entry per installed
  package, the reviewer's included.
- `src/prompt.ts`, `src/agent.ts`, `src/workflow.ts`: the writer's system
  prompt, `createWriterAgent` (which requires an explicit provider and model)
  and `createWriterWorkflow`, a bounded single-step workflow that runs once
  on its first message.
- `src/contract.ts`: `writerTaskMessage`, the schema-checked assignment.
- `src/reviewer/`: the reviewer's prompt, agent and workflow, built the same
  way.
- `src/approve/`: the approve screen.
- `skills/`: one skill per document kind, each a `SKILL.md` and a reference
  exemplar, including the coordinator's problem-brief skill.
- `src/skills.ts`: a Bun macro that inlines `skills/` when an agent bundle
  is built.

## Working on it

What a document should contain lives in its skill rather than the prompt;
prompt conventions are in [AGENTS.md][agents]. `bun run typecheck` and
`bun run test` cover it, and `bun run dev` runs it in a real project.

[coordinator]: https://github.com/corbitsdev/corbits-builder/tree/main/workflows/coordinator
[agents]: https://github.com/corbitsdev/corbits-builder/blob/main/AGENTS.md
