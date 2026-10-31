# Schemas

`@corbits-builder/schemas`: the arktype schemas and TypeScript types
for everything that crosses a boundary in Builder, such as projects,
documents and their sections, approvals, questions, conversations, settings
and model profiles.

## Where it fits

A plain shared library with no runtime of its own. It depends only on
arktype, and imports nothing from Builder or
Interchange. The [hub][hub] validates requests and stored content with it,
and the [client][client] and [interface][web] use the same types for the
responses they read.

## Layout

Each module in `src/` is one contract and is exported under its own path,
for example `@corbits-builder/schemas/project`. The package root is
`src/source-ref.ts`, the reference to one exact document version. A few
others:

- `artifact.ts`: filed artifacts and their content.
- `questions.ts`, `approaches.ts`: the open questions and the compared
  approaches filed with a document version.
- `project.ts`, `project-status.ts`, `project-import.ts`: project listing,
  live run state and imported project files.
- `conversation.ts`, `activity.ts`: chat mail and tool activity on the wire.
- `models.ts`, `catalog.ts`, `settings.ts`, `preferences.ts`: providers,
  profiles and per-person settings.

Modules not listed in `package.json` exports, such as `roles.ts`, are
internal building blocks of the exported ones.

## Working on it

A change here changes a wire or storage shape, so update the hub and the
client in the same change. `bun run typecheck` checks every importer and
`bun run test` runs the tests.

[hub]: https://github.com/corbitsdev/corbits-builder/tree/main/apps/hub
[client]: https://github.com/corbitsdev/corbits-builder/tree/main/packages/client
[web]: https://github.com/corbitsdev/corbits-builder/tree/main/apps/web
