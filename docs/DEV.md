# Local development

Setup is in
[CONTRIBUTING.md](https://github.com/corbitsdev/corbits-builder/blob/main/CONTRIBUTING.md#setup);
running with Docker Compose is in
[SELF_HOST.md](https://github.com/corbitsdev/corbits-builder/blob/main/docs/SELF_HOST.md).

## Architecture in brief

| Path                 | What it is                                                                                                                                                                                                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vendor/interchange` | The parts of [Interchange](https://github.com/faremeter/interchange) Builder runs, at the commit in `vendor/VENDORED_REVISION`, plus local patches recorded in `vendor/interchange.manifest.json`. It owns the agent loop, mail, spawning, approvals, credentials, sidecars and run lifecycle. |
| `apps/hub`           | The server: a Postgres control plane, tenancy and sign-in, documents (versioned artifacts with content hashes), approvals and the glue that starts each role. It runs Interchange in-process.                                                                                                  |
| `packages/client`    | A typed client for the hub's API (`@corbits-builder/client`). It never touches the database or Interchange internals.                                                                                                                                                                          |
| `apps/web`           | The UI: Vite and React over that client, with its own small router in `src/routes.ts`.                                                                                                                                                                                                         |
| `workflows/*`        | One package per role: its agent, prompt and workflow definition; the hub supplies its tools.                                                                                                                                                                                                   |
| `packages/schemas`   | Types and schemas shared by the hub, the client and the workflows.                                                                                                                                                                                                                             |
| `scripts/`           | Dev and verification scripts: pin and vendor checks, the commit check, the Google sign-in emulator, React UI API generation and the repository import (`bun run import:repo`, which writes a directory as a project file the import reads).                                                    |
| `deploy/`            | The Dockerfile and Compose files ([SELF_HOST.md](https://github.com/corbitsdev/corbits-builder/blob/main/docs/SELF_HOST.md)).                                                                                                                                                                  |

The roles:

- **Coordinator** (`workflows/coordinator`): one long-running workflow per
  project. It talks with the person, writes the problem brief and starts the
  other roles.
- **Writer** (`workflows/writer`): writes one document.
- **Reviewer** (`workflows/reviewer`): reviews one document.
- **Designer** (`workflows/designer`): builds the clickable design.
- **Coder** (`workflows/coder`): builds the app in a sandbox from its
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

The Settings browser tests build the web app and use the real hub with an
isolated test database. Install Chromium once, then run them with the same
`E2E_DB_*` settings as the other end-to-end tests:

```sh
bunx playwright install chromium
bun --env-file=.env.hub --conditions=intx-src test test/e2e/settings.test.ts
```

`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can point to an existing Chromium
installation instead. The tests cover every registered preference option,
saved choices after a reload, failed saves and conflicts, rapid changes,
browser-only settings, reviewers, keyboard controls and narrow layouts.

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
- Interchange docs: [Interchange's](https://github.com/faremeter/interchange) `docs/` folder at the commit in `vendor/VENDORED_REVISION`.

## Pull request visual evidence

`UI screenshots` builds Storybook at the PR event's exact base and head SHAs,
then uses the head revision's pinned Playwright Chromium to capture both builds.
It never starts Builder's hub, database or agents. It runs for `apps/web/**`,
workspace packages, vendor/patch changes, dependency manifests/lockfiles,
Storybook configuration and capture/CI infrastructure. All registered stories
are captured, rather than trying to infer affected stories. Functional and e2e
tests remain separate; screenshots do not verify authentication, routing or
persistence. CL-12281 owns the broader frontend/backend CI split.

Register a deterministic state with a `visual` tag on a story or its metadata:

```ts
export const SignIn: Story = { tags: ["visual"] };
```

Storybook's inherited tags work too; `!visual` opts a story out of an inherited
tag. Keep the story's title/export stable (or set an explicit metadata `id`)
to preserve its ID. The capture set is the union of tagged IDs from both
revisions: a newly registered existing story still gets a before image. A
missing ID is explicitly added/removed; a renamed ID is removal plus addition.
Removing only a tag still captures that ID for the transition PR.

Stories use plain fixture args and the existing view components. Avoid live
requests, unpredictable IDs and time-dependent fixture content. The runner
blocks external network requests, fixes Date and seeds Math.random, sets en-US
and UTC, uses bundled fonts, waits for Storybook 11's finished render phase
(including loaders/play), checks root visibility and the theme, waits for fonts
and images, disables screenshot animations and requires two stable captures.
Do not hide an expected render error with an empty story. Async states should
finish their loaders/play functions before capture; timers that update content
later are not a reliable fixture. Any runtime/console error, failed HTTP asset,
missing font/image or unstable/blank render fails capture. Changes in pixels
never fail CI. Pixelmatch uses a 0.1 threshold and ignores antialiasing-only
changes; inspect the actual images as well as highlighted differences.

Each story has four variants: 1440×1000 desktop and 390×844 mobile, each in
light and dark mode, at device scale 1. Images include the full page. Both
revisions use the same browser/OS, viewport, theme and rendering controls.
Each revision supplies its own bundled fonts so deliberate font changes remain
visible. The initial captures are sign-in, sign-up and the project library.

### Reviewing the report

One bot comment per PR lists changed/added/removed captures and links to the
`ui-visual-evidence` Actions artifact. Download and extract the ZIP, then open
`index.html`: changed pairs are expanded and unchanged pairs collapsed. PNGs,
highlighted differences, Markdown/JSON reports and build/capture logs are also
included. Artifacts expire after 30 days. GitHub sign-in/repository access is
required to download them. Images are **not inline in the PR comment**; this
was an explicit scope decision to avoid personal tokens and image hosting.

PR code runs with read-only repository access and no publishing secrets. A
separate `workflow_run` publisher executes only default-branch code, installs
no packages and restores no caches. It validates the originating workflow,
run, current PR head repository/SHA, artifact and report, reads only bounded
JSON from the ZIP without extracting it, and updates its marked bot comment.
Publishers are serialized; superseded heads, attempts and runs cannot replace
newer results. Forks use the same path after GitHub's normal approval of
external workflows. A changed base SHA requires a fresh capture rather than
posting mismatched evidence. The publisher does not run until its workflow
exists on the default branch; its first live comment must therefore be verified
after merge. No `pull_request_target` workflow runs contributed code.

### Local capture and validation

Build each revision in a separate checkout with its own frozen dependencies:

```sh
# In each checkout:
bun install --frozen-lockfile
bun run --cwd apps/web build-storybook

# In the proposed checkout (the runner and browser are shared by both builds):
bunx --no-install playwright install chromium
bun scripts/visual/capture.ts /absolute/base/apps/web/storybook-static \
  apps/web/storybook-static test-results/visual BASE_FULL_SHA HEAD_FULL_SHA
```

Use the exact SHAs of those checkouts, not a moving branch name. The report
records both; uncommitted edits require rebuilding and must be described as
local validation rather than evidence for a committed SHA.

```sh
bun run test:visual
bun scripts/visual/verify-browser.ts apps/web/storybook-static
```

The browser validation uses temporary copies of the real Storybook build to
check identical images, an intentional border change, added/removed IDs and
runtime/blank-render failures across the variants. Its optional second argument
copies the changed report to a directory for inspection. Run it when changing
the runner or upgrading Storybook/Playwright: the render-phase integration was
verified against Storybook 11.0.0-beta.0 and Playwright 1.64.1. See the official
[Storybook CI](https://storybook.js.org/docs/writing-tests/in-ci),
[tags](https://storybook.js.org/docs/11/writing-stories/tags),
[Playwright screenshots](https://playwright.dev/docs/screenshots) and
[Actions artifacts](https://docs.github.com/en/actions/tutorials/store-and-share-data)
documentation. No Vitest addon or baseline approval service is involved.

CI records build/browser/capture elapsed seconds in its job summary, and the
report records capture/comparison time. Use the run's timestamps for total CI
time, including setup; the under-five-minute goal is a target, not a measured
guarantee. The ten-minute job timeout catches hangs without treating a slow
runner as a pixel regression.
