# Builder: implementation

The concrete technology, package layout and configuration behind
[ARCHITECTURE.md](https://github.com/corbitsdev/corbits-builder/blob/main/docs/ARCHITECTURE.md).
Running it locally is in
[DEV.md](https://github.com/corbitsdev/corbits-builder/blob/main/docs/DEV.md),
and running it with Docker in
[SELF_HOST.md](https://github.com/corbitsdev/corbits-builder/blob/main/docs/SELF_HOST.md).

## Stack

| Concern           | Choice                                                                |
| ----------------- | --------------------------------------------------------------------- |
| Runtime and tools | Bun (version pinned in `package.json`), `bun fmt`, oxlint             |
| Hub HTTP          | Hono, with `hono-openapi` describing the routes                       |
| Database          | Postgres 17 through drizzle-orm; migrations with drizzle-kit          |
| Sign-in           | better-auth                                                           |
| Schemas           | arktype, shared through `packages/schemas`                            |
| Agent runtime     | Interchange (`@intx/*`)                                               |
| Sandboxes         | `@anthropic-ai/sandbox-runtime` (srt)                                 |
| App repository    | isomorphic-git against the runtime's git smart-HTTP repositories      |
| Documents         | `@corbits/artifacts` storage and migrations                           |
| Interface         | React and Vite with `@corbits/react-ui`                               |
| Client cache      | TanStack Query, persisted to IndexedDB through `idb-keyval`           |
| Logs              | LogTape: JSON lines to the console, and OpenTelemetry when configured |

## Interchange in the hub

The hub composes Interchange's control plane in its own process
([apps/hub/src/app.ts](https://github.com/corbitsdev/corbits-builder/blob/main/apps/hub/src/app.ts)):
the database stores from `@intx/db`, the session service, sidecar router and
workflow services from `@intx/hub-sessions`, and the native routes from
`@intx/hub-api` (`mountHubRoutes`), alongside the hub's own routes on one Hono
app.

Some `@intx/*` packages resolve to `vendor/interchange` through `workspace:*`
and some to published npm versions. Scripts run with `--conditions=intx-src`
so the vendored packages load from source.

### Sidecars

Agents run on sidecars, which the hub provisions
([apps/hub/src/provisioning/workflow-services.ts](https://github.com/corbitsdev/corbits-builder/blob/main/apps/hub/src/provisioning/workflow-services.ts)):

- **Local process sidecars** are always available. The hub spawns them from
  the vendored sidecar app on the same machine, keeps their state under
  `HUB_DATA_DIR`, and restores them after a restart. One holds up to
  `SIDECAR_LOCAL_MAX_ACTIVE` deployments.
- **Docker sidecars** are added when `SIDECAR_IMAGE` names an image (built
  from the `sidecar` target of
  [deploy/Dockerfile](https://github.com/corbitsdev/corbits-builder/blob/main/deploy/Dockerfile)),
  with memory, process and CPU limits from `SIDECAR_*`.

Placement uses the local sidecar until it is full, then the first matching
sandbox
([apps/hub/src/sidecar/placement.ts](https://github.com/corbitsdev/corbits-builder/blob/main/apps/hub/src/sidecar/placement.ts)).
Default lifetimes and retention come from `WORKFLOW_DEFAULT_*`.

### Role packages

Each role's workflow package is bundled per set of model bindings
([apps/hub/src/workflows/build-packages.ts](https://github.com/corbitsdev/corbits-builder/blob/main/apps/hub/src/workflows/build-packages.ts))
and installed into the project's tenant
([apps/hub/src/workflows/install-for-tenant.ts](https://github.com/corbitsdev/corbits-builder/blob/main/apps/hub/src/workflows/install-for-tenant.ts)).
Skills are packed into the bundle at build time with a Bun macro.

### Hub tools

The tools agents call live in the hub and reach the hub's API with the run's
own credential:

- documents: `read_artifact`, `write_artifact`
  ([apps/hub/src/artifacts/tools.ts](https://github.com/corbitsdev/corbits-builder/blob/main/apps/hub/src/artifacts/tools.ts));
- hand-offs and decisions: `request_approval`, `ask_questions`,
  `deploy_writer`, `review_artifact`, `design_app`, `deploy_coder`,
  `instruct_coder`
  ([apps/hub/src/projects/deploy-tools.ts](https://github.com/corbitsdev/corbits-builder/blob/main/apps/hub/src/projects/deploy-tools.ts));
- design filing: `file_design_option`
  ([apps/hub/src/artifacts/design-tools.ts](https://github.com/corbitsdev/corbits-builder/blob/main/apps/hub/src/artifacts/design-tools.ts));
- skills: `read_skill`
  ([apps/hub/src/skills/tools.ts](https://github.com/corbitsdev/corbits-builder/blob/main/apps/hub/src/skills/tools.ts));
- workspace tools for the designer and coder (files, shell, search, package
  installs, app status, browser)
  ([apps/hub/src/builds/](https://github.com/corbitsdev/corbits-builder/blob/main/apps/hub/src/builds)).

Builder's tool packages (`tools-*`) follow Interchange's tool-package
convention (`vendor/interchange/packages/agent/CONVENTIONS.md`), and keep each
tool's logic a plain function so a workflow action can call it directly.

The coder's browser tools are Playwright's MCP server inside its sandbox,
limited to loopback; its web search is Exa's MCP server
([apps/hub/src/config/mcp.ts](https://github.com/corbitsdev/corbits-builder/blob/main/apps/hub/src/config/mcp.ts)).

### Sandboxes and the live app

The designer's and coder's shell and file tools run under srt
([apps/hub/src/builds/posix-sandbox.ts](https://github.com/corbitsdev/corbits-builder/blob/main/apps/hub/src/builds/posix-sandbox.ts)).
srt's sandbox manager is process-global, so each job uses its own sidecar
process. `check-app` and `check_design` drive a shared Chrome for Testing
headless shell.

The live app
([apps/hub/src/live-app/](https://github.com/corbitsdev/corbits-builder/blob/main/apps/hub/src/live-app))
is one host process per open project, running the app under srt with
`bun run dev`, behind a proxy that gives each project's app its own port.

### App repository

Each project's app repository is an Interchange asset repository
([apps/hub/src/projects/app-repository.ts](https://github.com/corbitsdev/corbits-builder/blob/main/apps/hub/src/projects/app-repository.ts)).
A coder run gets a service token for `refs/heads/main`, and its workspace
clones and pushes with isomorphic-git
([apps/hub/src/builds/app-repository.ts](https://github.com/corbitsdev/corbits-builder/blob/main/apps/hub/src/builds/app-repository.ts)).
Environment files, installs and build output never leave the workspace.

## Package layout

| Path                      | Package                        | What it holds                                                    |
| ------------------------- | ------------------------------ | ---------------------------------------------------------------- |
| `apps/hub`                | `@corbits-builder/hub`         | The server: routes, services, hub tools, provisioning, live app. |
| `packages/client`         | `@corbits-builder/client`      | The typed client for the hub's API.                              |
| `apps/web`                | `@corbits-builder/web`         | The interface, built only on the client and the schemas.         |
| `workflows/coordinator`   | `@corbits-builder/coordinator` | The coordinator's agent, prompt and workflow.                    |
| `workflows/writer`        | `@corbits-builder/writer`      | The document writer and its per-kind skills.                     |
| `workflows/reviewer`      | `@corbits-builder/reviewer`    | The document reviewer.                                           |
| `workflows/designer`      | `@corbits-builder/designer`    | The designer, its starter, themes and skills.                    |
| `workflows/coder`         | `@corbits-builder/coder`       | The coder, its app starter and `check-app`.                      |
| `packages/schemas`        | `@corbits-builder/schemas`     | Types and schemas shared by the hub, client and workflows.       |
| `vendor/interchange`      |                                | Interchange at the pinned revision.                              |
| `deploy/`                 |                                | The Dockerfile and Compose files.                                |
| `scripts/`                |                                | Dev and verification scripts.                                    |
| `skills/`                 |                                | Agent skills to install Builder and drive it through its API.    |
| `test/integration`, `e2e` |                                | Cross-module and full-stack tests.                               |

Workflow packages declare their agents and workflows with Interchange's
definition exports (`@intx/agent/authoring`, `@intx/workflow/definition`).
Cross-workspace
imports use declared `@corbits-builder/*` exports and `workspace:*`
dependencies;
[test/integration/architecture.test.ts](https://github.com/corbitsdev/corbits-builder/blob/main/test/integration/architecture.test.ts)
checks that code imports Interchange by package name and that the interface
never imports the server or the database.

The coder's starter is a Bun workspace: a Vite and React client with
`@corbits/react-ui`, a Hono server and a shared schema package. Its own
[AGENTS.md](https://github.com/corbitsdev/corbits-builder/blob/main/workflows/coder/starter/AGENTS.md)
tells the coder where each kind of code goes.

## Configuration

- **Product name and wording.** The hub's in
  [apps/hub/src/config/](https://github.com/corbitsdev/corbits-builder/blob/main/apps/hub/src/config),
  the interface's in
  [apps/web/src/config.ts](https://github.com/corbitsdev/corbits-builder/blob/main/apps/web/src/config.ts).
  The default name is Builder.
- **Providers, models, roles, tiers and profiles.**
  [apps/hub/src/config/models.ts](https://github.com/corbitsdev/corbits-builder/blob/main/apps/hub/src/config/models.ts);
  each model's limits in
  [apps/hub/src/inference/model-limits.ts](https://github.com/corbitsdev/corbits-builder/blob/main/apps/hub/src/inference/model-limits.ts).
- **Preferences.**
  [apps/hub/src/config/preferences.ts](https://github.com/corbitsdev/corbits-builder/blob/main/apps/hub/src/config/preferences.ts).
- **Environment.** Every variable is described in
  [.env.hub.example](https://github.com/corbitsdev/corbits-builder/blob/main/.env.hub.example) and
  [.env.web.example](https://github.com/corbitsdev/corbits-builder/blob/main/.env.web.example).
- **Schema.**
  [apps/hub/src/db/schema.ts](https://github.com/corbitsdev/corbits-builder/blob/main/apps/hub/src/db/schema.ts)
  holds the hub's own tables; identities, grants, approvals and runs are
  Interchange's.

## Vendor policy

`vendor/interchange` is upstream
[Interchange](https://github.com/faremeter/interchange) at the commit in
[vendor/VENDORED_REVISION](https://github.com/corbitsdev/corbits-builder/blob/main/vendor/VENDORED_REVISION),
plus deliberate changes. Each change is its own `(vendor)` commit that also
updates
[vendor/interchange.manifest.json](https://github.com/corbitsdev/corbits-builder/blob/main/vendor/interchange.manifest.json).
`bun run vendor:verify` fails on any unrecorded change.

## Who owns what

Builder sits on two sets of packages it does not own. Use theirs before
writing anything of its kind.

- **Interchange** (`@intx/*`) owns running agents: workflows, triggers and
  gates, the agent loop, tools and tool packages, directors and compaction,
  inference providers, mail, approvals, grants and credentials, sidecars and
  isolation, lifetimes and cancellation. Its docs are under
  [vendor/interchange/docs/](https://github.com/corbitsdev/corbits-builder/blob/main/vendor/interchange/docs),
  and each package documents itself in `vendor/interchange/packages/<name>/`.
  A vendor design marked as not yet built is not a capability; confirm the
  code exists before relying on it.
- **Corbits packages** (`@corbits/*`) are shared across Corbits products:
  document storage (`artifacts`), the interface kit (`react-ui`), provider
  adapters and logins, MCP and agent tokens.
- **Builder** owns the product on top: projects and their documents, the
  hub's own routes and tenant state, the role workflows, prompts and skills,
  its tool packages, product configuration and the interface.

When a change needs something that none of them clearly owns, or that one of
the first two almost covers, raise it before building: it may belong upstream,
as a deliberate vendor change, or in a Corbits package.

`@intx/*` packages come from npm where a published version serves. A package
is vendored only when Builder patches it or needs Interchange's main past the
published release.
