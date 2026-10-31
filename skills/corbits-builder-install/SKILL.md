---
name: corbits-builder-install
description: Gets Builder running on this machine, from finding or cloning the checkout to the person signing up and connecting a model provider. Use whenever someone wants to install, set up, run, start, self-host or try Builder (Corbits Builder, corbitsdev/corbits-builder), with Docker Compose or with their own Postgres, or when a Builder checkout won't start. For driving projects through Builder's API once it runs, use operate-corbits-builder instead.
---

# Install Builder

Get Builder running on this machine and hand it to the person ready to sign
up. For a server behind a proxy or on a public domain, follow
[SELF_HOST.md](https://github.com/corbitsdev/corbits-builder/blob/main/docs/SELF_HOST.md)
instead.

- **The person does their own steps**: signing up and connecting a model
  provider. Tell them what to open and press, then wait.
- **Secrets stay in `.env.hub`** and are never printed; report only which settings
  are set.
- **Keep an existing `.env.hub`.** Its keys already encrypt stored data; new ones
  lock Builder out of it.

## 1. Find the checkout

Work from the root of a Builder checkout (a folder with `deploy/compose.yml`).
If the current folder is not one, ask where it is, or clone
`https://github.com/corbitsdev/corbits-builder.git` where the person chooses.

## 2. Choose a path

Suggest Docker Compose if `docker info` succeeds, otherwise their own Postgres 17. Let the person decide.

| Path           | Needs                  | Builder opens at        |
| -------------- | ---------------------- | ----------------------- |
| Docker Compose | Docker with Compose    | `http://localhost:8000` |
| Own Postgres   | Bun 1.4.4, Postgres 17 | `http://localhost:5173` |

## 3. Write `.env.hub` and `.env.web`

If `.env.hub` exists, keep it. Otherwise `cp .env.hub.example .env.hub` and fill each
empty secret it marks (`DB_PASSWORD`, `BETTER_AUTH_SECRET`,
`CREDENTIAL_ENCRYPTION_KEY`, `PRINCIPAL_KEY_ENCRYPTION_KEY`) with its own fresh
random value, such as `openssl rand -hex 32`, written straight into `.env.hub`
without printing it. Tell the person to keep a copy of `.env.hub` apart from the database: its keys
decrypt their stored provider keys. On the own-Postgres path, also
`cp .env.web.example .env.web` if it is missing.

`PORT` (default 8000) is Builder's port, `UI_PORT` (5173) the UI dev server's
and `DB_PORT` (5433) the Compose database's. If a port is taken, set `PORT` or
`DB_PORT` in `.env.hub` (and `UI_HUB_ORIGIN` in `.env.web` to match `PORT`), or
`UI_PORT` in `.env.web`.

## 4. Start Builder

**Docker Compose**:
`docker compose --env-file .env.hub --project-directory . -f deploy/compose.yml up -d --build`
builds and starts Builder and Postgres. It is up when the hub logs `Hub ready`
(`docker compose --env-file .env.hub --project-directory . -f deploy/compose.yml logs hub`).

**Own Postgres**
([CONTRIBUTING.md](https://github.com/corbitsdev/corbits-builder/blob/main/CONTRIBUTING.md),
"Setup"): run `bun install`, ask the person for their `DATABASE_URL` and have
them put it in `.env.hub` (or create the database first if needed), then
`bun run dev`. It is up when the hub logs `Hub ready`.

## 5. Hand over to the person

Give them the address (with any port you changed) and these steps:

1. **Create an account** with any email and password. Locally there is no
   email to verify.
2. **Connect a model provider** on the screen that follows: paste an API key
   (Anthropic, OpenAI, Gemini) or log in with a subscription (ChatGPT, xAI).
   It is also under **Settings → Providers**.
3. **Describe an idea** in a new project.

Wait for them to confirm before you call it done.

## Stop and remove

**Docker Compose**:

```sh
docker compose --env-file .env.hub --project-directory . -f deploy/compose.yml stop   # stop, keep everything
docker compose --env-file .env.hub --project-directory . -f deploy/compose.yml down   # remove containers, keep data
```

`down -v` also deletes every account, project and stored key; run it only when
the person asks to start over.

**Own Postgres**: stop `bun run dev`. The data stays in their database.
