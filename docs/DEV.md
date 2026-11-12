# Local development

Setup is in
[CONTRIBUTING.md](https://github.com/corbitsdev/corbits-builder/blob/main/CONTRIBUTING.md#setup);
running with Docker Compose is in
[SELF_HOST.md](https://github.com/corbitsdev/corbits-builder/blob/main/docs/SELF_HOST.md).

## Architecture in brief

| Path                 | What it is                                                                                                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vendor/interchange` | [Interchange](https://github.com/faremeter/interchange) at the commit in `vendor/VENDORED_REVISION`, plus local patches recorded in `vendor/interchange.manifest.json`. It owns the agent loop, mail, spawning, approvals, credentials, sidecars and run lifecycle. |
| `apps/hub`           | The server: a Postgres control plane, tenancy and sign-in, documents (versioned artifacts with content hashes), approvals and the glue that starts each role. It runs Interchange in-process.                                                                       |
| `packages/client`    | A typed client for the hub's API (`@corbits-builder/client`). It never touches the database or Interchange internals.                                                                                                                                               |
| `apps/web`           | The UI: Vite and React over that client, with its own small router in `src/routes.ts`.                                                                                                                                                                              |
| `workflows/*`        | One package per role: its agent, prompt and workflow definition; the hub supplies its tools.                                                                                                                                                                        |
| `packages/schemas`   | Types and schemas shared by the hub, the client and the workflows.                                                                                                                                                                                                  |
| `scripts/`           | Dev and verification scripts: pin and vendor checks, the commit check, the Google sign-in emulator, React UI API generation and the repository import (`bun run import:repo`, which writes a directory as a project file the import reads).                         |
| `deploy/`            | The Dockerfile and Compose files ([SELF_HOST.md](https://github.com/corbitsdev/corbits-builder/blob/main/docs/SELF_HOST.md)).                                                                                                                                       |

The roles:

- **Coordinator** (`workflows/coordinator`): one long-running workflow per
  project. It talks with the person, writes the problem brief and starts the
  other roles.
- **Writer** (`workflows/writer`): writes one document.
- **Reviewer** (`workflows/reviewer`): reviews one document.
- **Designer** (`workflows/designer`): builds the clickable design.
- **Coder** (`plugins/coder`): builds the app in a sandbox from its
  starter.

Each role runs on the tier its profile assigns
([apps/hub/src/config/models.ts](https://github.com/corbitsdev/corbits-builder/blob/main/apps/hub/src/config/models.ts)), so any
connected provider can run any role. The project's conventions are in
[AGENTS.md](https://github.com/corbitsdev/corbits-builder/blob/main/AGENTS.md), and what Interchange, Corbits packages and Builder each own in
[IMPLEMENTATION.md](https://github.com/corbitsdev/corbits-builder/blob/main/docs/IMPLEMENTATION.md#who-owns-what).

## Model profile choice

There is no default profile. When a project's coordinator starts, it runs on:

1. The profile the project was created with, when this server can run it.
2. Else the person's chosen profile under **Settings → Profiles**, when this
   server can run it.
3. Else, with exactly one provider connected, that provider's profile.
4. Else the coordinator does not start, and the UI asks the person to connect
   a provider or pick a profile. The project starts once one resolves.

The resolved profile is fixed for the life of the project.

Agents run in sidecar processes the hub starts on this machine; their state
lives under `HUB_DATA_DIR` (`data/hub`). Docker sidecars are optional
([SELF_HOST.md](https://github.com/corbitsdev/corbits-builder/blob/main/docs/SELF_HOST.md#sidecars-in-docker)).

## Tests

```sh
bun run lint
bun run format:check
bun run typecheck
bun run test          # unit and integration tests
bun run pins:verify   # pinned dependency versions
bun run vendor:verify # vendored Interchange matches its manifest
bun run test:e2e      # model logins and project replay against an isolated Postgres
```

`bun run test:e2e` reads the `E2E_DB_*` values from `.env.hub`. Start its
throwaway database under its own project name, so it never replaces the
development database:

```sh
docker compose -p builder-e2e --env-file .env.hub --project-directory . -f deploy/compose.test.yml up -d --wait
```

Tests are load-bearing only: invariants and end-to-end behaviour through the
real API ([CONTRIBUTING.md](https://github.com/corbitsdev/corbits-builder/blob/main/CONTRIBUTING.md#rules-worth-knowing),
[test/AGENTS.md](https://github.com/corbitsdev/corbits-builder/blob/main/test/AGENTS.md)).

## Other scripts

| Script                    | What it does                                                                                                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run start`           | Starts the hub alone, without the migrations or the UI dev server.                                                                                                                       |
| `bun run dev:hub`         | Starts the hub alone for the UI dev server on `UI_PORT` (from the shell; `bun run dev` also reads it from `.env.web`).                                                                   |
| `bun run dev:web`         | Starts the UI dev server alone.                                                                                                                                                          |
| `bun run dev:stop`        | Stops every Builder process on this machine (hubs, migrations, UI dev servers, what they spawned) and names whatever else holds a port `bun run dev` needs; `--dry-run` only lists them. |
| `bun run format`          | Formats the tree with bun fmt.                                                                                                                                                           |
| `bun run lint`            | oxlint, warnings are errors.                                                                                                                                                             |
| `bun run typecheck`       | Typechecks the hub, the client API and the UI.                                                                                                                                           |
| `bun run db:migrate`      | Applies the migrations.                                                                                                                                                                  |
| `bun run db:generate`     | Generates a migration from `apps/hub/src/db/schema.ts`.                                                                                                                                  |
| `bun run docker:up`       | Builds and starts Builder in Docker ([SELF_HOST.md](https://github.com/corbitsdev/corbits-builder/blob/main/docs/SELF_HOST.md)).                                                         |
| `bun run docker:sidecar`  | Builds the sidecar Docker image.                                                                                                                                                         |
| `bun run auth:bootstrap`  | Migrates and creates the `BOOTSTRAP_*` machine account and workspace.                                                                                                                    |
| `bun run auth:emulate`    | Starts a loopback Google sign-in emulator (`GOOGLE_EMULATE_URL` in `.env.hub.example`).                                                                                                  |
| `bun run dev:seed`        | Seeds dummy projects (`habit-tracker`, `field-service-dispatch`, `clinical-trial-intake`) at a chosen lifecycle stage.                                                                   |
| `bun run import:repo`     | Writes a directory, usually a git repository, as the project file **Import project** reads and names the Builder documents it lacks (`--help` lists the options).                        |
| `bun run vendor:verify`   | Checks `vendor/interchange` matches its pinned upstream commit.                                                                                                                          |
| `bun run skills:react-ui` | Regenerates the designer's `@corbits/react-ui` API reference.                                                                                                                            |

## Migrations

Create migrations with `bun run db:generate`. The migrator skips any migration
whose journal `when` is not later than the newest one a database has applied,
and `apps/hub/src/db/migrate.test.ts` fails when the journal is out of order.
Never move a `when` that has merged: databases keep the value they applied.

Until 8 November 2026 01:06:40 UTC, a generated `when` sorts before 0038's; set
it to one more than the previous entry's. Delete this paragraph after that date.

## Seeding dummy projects

`bun run dev:seed` populates a workspace tenant (defaulting to the first
workspace tenant in Postgres, or creating a local development workspace if the
database is empty) with up to three realistic dummy projects across any stage
(`idea`, `brief`, `planning`, `design_options`, `designed`, `ready_to_build`,
`shipped`), and gives a workspace with no saved reviewers three demo
reviewers:

```sh
bun run dev:seed                                                      # all 3 fixtures at their default stages
bun run dev:seed -- --fixture=habit-tracker --stage=planning          # single fixture with planning docs approved
bun run dev:seed -- --fixture=field-service-dispatch --stage=planning --no-approve
bun run dev:seed -- --fixture=clinical-trial-intake --stage=design_options
bun run dev:seed -- --stage=ready_to_build --tenant=<workspaceTenantId>
```

## Where things live

- Product names and user-visible wording: `apps/hub/src/config/` and
  `apps/web/src/config.ts`. The default name is **Builder**.
- Providers, models, roles and profiles: `apps/hub/src/config/models.ts`;
  each model's limits: `apps/hub/src/inference/model-limits.ts`.
- Database schema and migrations: `apps/hub/src/db/`.
- Hub routes: mounted in `apps/hub/src/app.ts`; each project's routes in
  `apps/hub/src/projects/routes.ts`.
- Starting and placing sidecars: `apps/hub/src/provisioning/`,
  `apps/hub/src/sidecar/`.
- Each role's prompt: `workflows/<role>/src/`. Its `defineTool` tools:
  `apps/hub/src/` (`artifacts/`, `projects/`, `builds/`, `skills/`).
- Interchange docs: `vendor/interchange/docs/`.
