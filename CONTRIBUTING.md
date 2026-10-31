# Contributing

Thanks for your interest in Builder. This guide takes you from a fresh clone
to a running app, then through sending a change.

## Prerequisites

| Tool                  | Version    | What it is for                                         |
| --------------------- | ---------- | ------------------------------------------------------ |
| [Bun](https://bun.sh) | 1.4.4      | Runs everything: install, the hub, the UI, the checks. |
| Postgres              | 17         | Builder's database. Bring your own.                    |
| Docker                | any recent | Optional: a local Postgres and the e2e test database.  |
| git                   | any recent | Cloning, and the commit hooks.                         |

Bun is pinned in `package.json` (`engines` and `packageManager`) and CI uses
the same version. You also need an API key or subscription login for at least
one [model provider](https://github.com/corbitsdev/corbits-builder/blob/main/docs/SELF_HOST.md#models) to run a project.

## Setup

1. Clone and install.

   ```sh
   git clone https://github.com/corbitsdev/corbits-builder.git
   cd corbits-builder
   bun install
   ```

2. Create `.env.hub` and `.env.web`.

   ```sh
   cp .env.hub.example .env.hub
   cp .env.web.example .env.web
   ```

   Fill in each secret `.env.hub` marks as required with its own random value, for
   example from `openssl rand -hex 32`. Losing the encryption keys makes stored
   provider keys unreadable. The other defaults work as they are; every
   variable is described in
   [.env.hub.example](https://github.com/corbitsdev/corbits-builder/blob/main/.env.hub.example) and
   [.env.web.example](https://github.com/corbitsdev/corbits-builder/blob/main/.env.web.example).

3. Point Builder at your Postgres 17. Create an empty database, then set
   `DATABASE_URL` in `.env.hub`; it replaces the `DB_HOST`, `DB_PORT`, `DB_USER`,
   `DB_PASSWORD` and `DB_NAME` values.

   ```sh
   createdb corbits_builder
   ```

   ```sh
   DATABASE_URL=postgres://user:password@127.0.0.1:5432/corbits_builder
   ```

   With Docker instead, start only the Compose database. It uses the `DB_*`
   values `.env.hub` already holds, so leave `DATABASE_URL` unset:

   ```sh
   docker compose --env-file .env.hub --project-directory . -f deploy/compose.yml up -d --wait db
   ```

4. Start the app.

   ```sh
   bun run dev
   ```

   This applies the migrations, then starts the hub on http://localhost:8000
   and the UI on http://localhost:5173. The UI hot-reloads; restart after
   changing `apps/hub`, `workflows/` or `packages/`. If a port is taken, set
   `PORT` or `DB_PORT` in `.env.hub` (and `UI_HUB_ORIGIN` in `.env.web` to
   match `PORT`), or `UI_PORT` in `.env.web`.

5. Sign in. Open http://localhost:5173 and choose **Create an account** with
   any email and password. Locally there is no email to verify.

6. Connect a model provider on the **Connect a model provider** screen that
   follows, or later under **Settings → Providers**. Or, before step 4, set
   `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `GEMINI_API_KEY` in `.env.hub`; every
   workspace inherits it and the screen is skipped.

Now describe an idea in a new project.
[docs/DEV.md](https://github.com/corbitsdev/corbits-builder/blob/main/docs/DEV.md)
covers the architecture, tests and other scripts.

## Making a change

1. Turn on the git hooks once per clone:

   ```sh
   git config core.hooksPath .githooks
   ```

   Before each commit they run the format check, lint and typecheck, and check
   the commit message.

2. Make one logical change. One change per pull request and per commit.

3. Run the gate. These must pass before and after your change:

   ```sh
   bun run lint
   bun run format:check
   bun run typecheck
   bun run test          # unit and integration tests
   bun run pins:verify   # pinned dependency versions
   bun run vendor:verify # vendored Interchange matches its manifest
   ```

   `bun run format` fixes formatting. Changes to model logins also need
   `bun run test:e2e` against a real Postgres
   ([docs/DEV.md](https://github.com/corbitsdev/corbits-builder/blob/main/docs/DEV.md#tests)).

4. Commit with a [Conventional Commit](https://www.conventionalcommits.org)
   subject, `<type>(<scope>): <description>`, at most 72 characters, for
   example `fix(hub): refuse a design approval for a stale version`. No
   attribution trailers such as `Co-Authored-By`.

5. Open a pull request that says what changed and how you verified it.

Contributions are accepted under the
[Contributor License Agreement](https://github.com/corbitsdev/corbits-builder/blob/main/CLA.md); opening a pull request means you
agree to it. [AGENTS.md](https://github.com/corbitsdev/corbits-builder/blob/main/AGENTS.md) holds the conventions every
change follows, whether a person or a coding agent writes it.

### Rules worth knowing

- **Tests are load-bearing.** Write one when it guards an invariant (an
  approval binds to an exact version, a secret never reaches a response) or
  proves behaviour end to end through the real API. Unit tests live beside
  their code; cross-module checks go in `test/integration`, real service
  tests in `test/e2e`.
- **Model-agnostic.** Every role runs on any supported provider and model.
- **No secrets.** The `.env.*.example` files are the only tracked env files.
- **`vendor/interchange` is upstream code**, pinned at
  [vendor/VENDORED_REVISION](https://github.com/corbitsdev/corbits-builder/blob/main/vendor/VENDORED_REVISION). Propose changes at
  [faremeter/interchange](https://github.com/faremeter/interchange). A
  deliberate local change is its own commit that also updates
  `vendor/interchange.manifest.json`; `bun run vendor:verify` fails on
  anything unrecorded.

## Releasing

Maintainers bump `version` in the root, `apps/hub`, `apps/web`,
`packages/client`, `packages/schemas`, `packages/tools-artifacts`,
`packages/tools-design` and `packages/tools-hub` package.json files, run
`bun install`, and merge. Once the publish workflow for that commit on main has
finished, `git tag -s vX.Y.Z && git push origin vX.Y.Z` retags its hub and
sidecar images as `X.Y.Z` and publishes the GitHub release; a 0.x version or
one with a `-` suffix is a pre-release tagged `rc`, any other is `latest`.

## Security

Report vulnerabilities through [SECURITY.md](https://github.com/corbitsdev/corbits-builder/blob/main/SECURITY.md), never a public
issue.

## License

Builder is licensed under [GPLv2 with the AI Exception](https://github.com/corbitsdev/corbits-builder/blob/main/LICENSE.md).
