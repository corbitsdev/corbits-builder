# Presenter

The package presenter: builds a slide deck and approval package for one audience
persona from the project's approved documents and filed design tokens.

## Where it fits

This folder is the whole presenter plugin. Its `package.json` `builder` block
declares its role, its one action, `present`, which needs the documents it
presents approved, the agent the hub builds and installs from its prompt,
skills and role (`agents`) and the starter that starts its runs (`starters`). The
[coordinator][coordinator] starts it with `execute`. The presenter's tools are
the hub's `write_deck`, `check_deck`, `file_package`, `read_skill`,
`read_file` and `search_files` over the documents laid in its workspace, and
`report_blocked`; it has no project read tool, because its assignment carries
the selected documents and design tokens.

## Layout

- `src/present/definition.ts`: the `present` action's input and how the
  coordinator fills it.
- `src/start.ts`: the starter, which writes the run's assignment from the
  approved documents and the design's tokens.
- `prompt.md`: the system prompt.
- `skills/presenting/`: the `presenting` skill (`SKILL.md`), covering the core
  deck rules and per-persona guidance (`ceo`, `cto`, `investor`, `client`,
  `end_user`).

## Working on it

What a presentation should contain lives in its skill rather than the prompt;
prompt conventions are in [AGENTS.md][agents]. `bun run typecheck` and `bun run test` cover it, and `bun run dev` runs it in a
real project.

[coordinator]: https://github.com/corbitsdev/corbits-builder/tree/main/workflows/coordinator
[agents]: https://github.com/corbitsdev/corbits-builder/blob/main/AGENTS.md
