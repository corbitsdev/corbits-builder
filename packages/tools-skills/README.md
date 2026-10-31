# Tools skills

`@corbits-builder/tools-skills`: the `read_skill` tool. `createSkillTools`
takes the skill names a role may read and returns a tool bundle whose
description lists each skill and when to use it; a call returns the skill's
`SKILL.md` or one of its reference files, in numbered parts when long.

## Where it fits

The skills come from the [designer][designer] and [writer][writer] packages
through Bun macros, so they ship inside each workflow bundle. The [hub][hub]
attaches the tool to the coordinator, writer and coder.

## Layout

- `src/index.ts`: the package's exports.
- `src/read-skill.ts`: `readSkill`, the call's logic over a skills map.
- `src/definitions.ts`: `readSkillDefinition`, the tool definition.
- `src/tools.ts`: `createSkillTools`, the `defineTool` bundle.

## Working on it

The tool name and bundle id form the grant name; keep both stable.
`bun run typecheck` checks every importer.

[designer]: https://github.com/corbitsdev/corbits-builder/tree/main/workflows/designer
[hub]: https://github.com/corbitsdev/corbits-builder/tree/main/apps/hub
[writer]: https://github.com/corbitsdev/corbits-builder/tree/main/workflows/writer
