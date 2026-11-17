# Writer

Any document the work needs: the writer writes one document of any kind per
run, the reviewer gives the coordinator a second opinion on one, and the
approve screen puts filed documents in front of the person.

## Where it fits

This folder is the whole writer plugin, with two agents. Its `package.json`
`builder` block names its actions (`write`, `write-requirements`,
`write-build-plan`, `review` and the `approve` screen), the agents the hub
builds and installs from their prompts, skills and roles (`agents`) and the
starter of each (`starters`). The writer is installed once each for the product requirements
and the build plan, whose `write_artifact` saves only that kind, and once as
`writer-document`, which writes any other document under the kind its task
names. The reviewer is the `reviewer` agent. The
[coordinator][coordinator] starts them with `execute`.

The writer's tools are the hub's `write_artifact`, `read_artifact` (for a
file a project value names), `report_values`, `read_skill`, `read_file` and
`search_files`. Its task names the source documents placed in the inputs
folder. The reviewer has `mail`, `read_file` and `search_files`: its task
names the document to review and the problem brief when one is filed, and the
coordinator weighs its findings as advice.

## Layout

- `src/write/`, `src/write-requirements/`, `src/write-build-plan/`,
  `src/review/`: one folder per action, whose `definition.ts` holds its input
  and how the coordinator fills it: its summary, when to use it and when not,
  and each field. The manifest keeps only what the folder cannot say, such as
  what the action requires and returns and which workflow it starts.
- `src/start.ts`, `src/start-document.ts`, `src/start-review.ts`: the
  starters of the per-kind writers, the writer of any document and the
  reviewer. Each writes its run's assignment from the filed documents.
- `src/task.ts`: the assignment both agents get, with every document it
  builds on read in full. A build plan is offered the starters a first build
  can start from, as the host hands them to the starter.
- `prompt.md`, `reviewer.md`: the writer's and the reviewer's system prompts.
- `src/contract.ts`: `writerTaskMessage`, the schema-checked assignment.
- `src/approve/`: the approve screen: its `definition.ts`, which validates the
  input and prepares what `view.tsx` draws.
- `skills/`: one skill per kind of document that has one (problem brief,
  constraints, approaches, product requirements, build plan), each a
  `SKILL.md` and reference exemplars, each usable on its own.

## Working on it

What a document should contain lives in its skill rather than the prompt;
prompt conventions are in [AGENTS.md][agents]. `bun run typecheck` and
`bun run test` cover it, and `bun run dev` runs it in a real project.

[coordinator]: https://github.com/corbitsdev/corbits-builder/tree/main/workflows/coordinator
[agents]: https://github.com/corbitsdev/corbits-builder/blob/main/AGENTS.md
