# Hub

The Builder server. It composes native Interchange with Builder's tenancy,
sign-in, projects, versioned documents and approvals on Postgres, starts each
role's workflow, and serves the built interface on the same origin.

## Where it fits

The hub runs Interchange in-process. It imports
the role packages in [`workflows/`][workflows] and builds each one into a
deployable workflow package with hub-supplied tools, and it shares types with
the client through [`packages/schemas`][schemas]. The [client][client] and the
[interface][web] reach it only over HTTP. Scripts and tests
use a few of its package exports.

## Layout

- `src/server.ts`: the process entry; `src/app.ts` composes the runtime.
- `src/config/`: user-visible wording, model tiers and other settings.
- `src/projects/`, `src/artifacts/`, `src/settings/`, `src/invitations/`,
  `src/audit/`: services and routes for each product area.
- `src/workflows/`: the role entries and the bundling that turns
  `workflows/*` into packages; `entries/` holds one module per role.
- `src/builds/`, `src/live-app/`: the coder's sandbox, tools, starter app
  and live preview.
- `src/sidecar/`, `src/provisioning/`: where agent sidecars run.
- `src/mail/`, `src/auth/`: conversations and agent grants.
- `src/db/`: the Drizzle schema and migrations.

## Working on it

The hub needs a real Postgres and reads its settings from `.env.hub`, copied
from `.env.hub.example`; [setup][setup] covers both. `bun run dev` migrates
the database and starts the hub with the interface, and `bun run start` runs
the hub alone. `bun run lint`, `bun run format:check`, `bun run typecheck`
and `bun run test` check it. The
[Interchange docs map][interchange-docs] lists the Interchange doc for each
area; read it before building on one.

[workflows]: https://github.com/corbitsdev/corbits-builder/tree/main/workflows
[schemas]: https://github.com/corbitsdev/corbits-builder/tree/main/packages/schemas
[client]: https://github.com/corbitsdev/corbits-builder/tree/main/packages/client
[web]: https://github.com/corbitsdev/corbits-builder/tree/main/apps/web
[setup]: https://github.com/corbitsdev/corbits-builder/blob/main/CONTRIBUTING.md#setup
[interchange-docs]: https://github.com/corbitsdev/corbits-builder/blob/main/docs/IMPLEMENTATION.md#interchange-docs-map
