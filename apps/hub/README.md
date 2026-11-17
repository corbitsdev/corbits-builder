# Hub

The Builder server. It composes native Interchange with Builder's tenancy,
sign-in, projects, versioned documents and approvals on Postgres, runs the
coordinator and the plugins' workflows, and serves the built interface on the
same origin.

## Where it fits

The hub runs Interchange in-process. It reads every plugin under
[`plugins/`][plugins] when it starts, through `@corbits-builder/plugin-host`,
and builds the coordinator in [`workflows/coordinator`][workflows] and each
plugin's workflows and agents into deployable workflow packages with
hub-supplied tools. It names no plugin in its code, and it shares types with
the client through [`packages/schemas`][schemas]. The [client][client] and the
[interface][web] reach it only over HTTP. Scripts and tests
use a few of its package exports.

## Layout

- `src/server.ts`: the process entry; `src/app.ts` composes the runtime.
- `src/config/`: user-visible wording, model tiers and other settings.
- `src/projects/`, `src/artifacts/`, `src/settings/`, `src/invitations/`,
  `src/audit/`: services and routes for each product area.
- `src/plugins/`: the plugin catalog read from `plugins/`, the coordinator's
  tools, plugin checks and the facts a plan step waits on.
- `src/workflows/`: the coordinator's entry and the bundling that turns the
  coordinator and each plugin's workflows into packages.
- `src/builds/`, `src/live-app/`: the designer's and coder's sandbox and
  tools, and the live preview.
- `src/sidecar/`, `src/provisioning/`: where agent sidecars run.
- `src/mail/`, `src/auth/`: conversations and agent grants.
- `src/db/`: the Drizzle schema and migrations.

## Working on it

The hub needs a real Postgres and reads its settings from `.env.hub`, copied
from `.env.hub.example`; [setup][setup] covers both. `bun run dev` migrates
the database and starts the hub with the interface, and `bun run start` runs
the hub alone. `bun run lint`, `bun run format:check`, `bun run typecheck`
and `bun run test` check it. The
[ownership notes][interchange-docs] say what Interchange, Corbits packages
and the hub each own.

[plugins]: https://github.com/corbitsdev/corbits-builder/tree/main/plugins
[workflows]: https://github.com/corbitsdev/corbits-builder/tree/main/workflows/coordinator
[schemas]: https://github.com/corbitsdev/corbits-builder/tree/main/packages/schemas
[client]: https://github.com/corbitsdev/corbits-builder/tree/main/packages/client
[web]: https://github.com/corbitsdev/corbits-builder/tree/main/apps/web
[setup]: https://github.com/corbitsdev/corbits-builder/blob/main/CONTRIBUTING.md#setup
[interchange-docs]: https://github.com/corbitsdev/corbits-builder/blob/main/docs/IMPLEMENTATION.md#who-owns-what
