# Self-host

Running Builder with Docker Compose. Local development with `bun run dev` is
in [DEV.md](https://github.com/corbitsdev/corbits-builder/blob/main/docs/DEV.md).
You need Docker with Compose and an API key or subscription login for at least
one [model provider](#models).

`deploy/compose.yml` runs Postgres 17 and the hub, which applies the
migrations, then serves the API and the UI. Run every compose command from the
repo root.

## Configure

```sh
cp .env.hub.example .env.hub
```

Give each secret `.env.hub` marks its own random value, for example from
`openssl rand -hex 32`; Builder refuses to start without them. Losing or
changing the encryption keys makes stored provider keys unreadable. Every other
setting is optional and described in
[.env.hub.example](https://github.com/corbitsdev/corbits-builder/blob/main/.env.hub.example).

Behind a proxy or on a public domain, set `BETTER_AUTH_BASE_URL` to the URL
people open, and `HUB_PUBLIC_URL`, `HUB_API_ORIGIN` and `UI_PUBLIC_URL` when
they differ from it. If a port is taken, `PORT` moves Builder (default `8000`)
and `DB_PORT` the database (default `5433`).

## Models

Connect a provider in the UI under **Settings → Providers**, or set its key in
`.env.hub` before starting so every workspace on this server can use it
(`SERVER_PROVIDER_KEYS=false` turns that off).

| Provider        | Connect with        |
| --------------- | ------------------- |
| Anthropic       | `ANTHROPIC_API_KEY` |
| OpenAI          | `OPENAI_API_KEY`    |
| Google Gemini   | `GEMINI_API_KEY`    |
| xAI API         | `XAI_API_KEY`       |
| ChatGPT (Codex) | Subscription login  |
| xAI             | Subscription login  |

How profiles map models to roles is in
[ARCHITECTURE.md](https://github.com/corbitsdev/corbits-builder/blob/main/docs/ARCHITECTURE.md#models-and-profiles).

## Run it

```sh
docker compose --env-file .env.hub --project-directory . -f deploy/compose.yml up -d --build   # start or update
docker compose --env-file .env.hub --project-directory . -f deploy/compose.yml logs -f hub     # follow the logs
docker compose --env-file .env.hub --project-directory . -f deploy/compose.yml down            # stop, keep the data
```

Open http://localhost:8000 (or your `PORT`), create an account, then add a
provider under **Settings → Providers**, or set a provider key in `.env.hub` before
starting. With one provider, projects run on its profile; with several, each
person picks one under **Settings → Profiles**
([how the choice works](https://github.com/corbitsdev/corbits-builder/blob/main/docs/DEV.md#model-profile-choice)).
To update, pull the new commits and start it again; the hub applies new
migrations as it starts.

Login with ChatGPT and Login with xAI finish by sending the browser to
`localhost:1455` and `localhost:1456`, so they work only when the browser runs
on the same machine as Builder, and only one Builder at a time can hold those
ports. On a server, use API keys, or forward both ports over SSH
(`ssh -L 1455:localhost:1455 -L 1456:localhost:1456 <server>`) while logging in.

`down -v` also deletes the volumes: every account, project, document, built
app and stored provider key. It cannot be undone.

To create a machine account and workspace without the UI, set the
`BOOTSTRAP_*` values in `.env.hub` and run the `setup` service once:

```sh
docker compose --env-file .env.hub --project-directory . -f deploy/compose.yml --profile setup run --rm setup
```

## Sandboxes

The coder and designer run every command under bubblewrap, which needs a user
namespace with its capabilities intact, mount propagation and a fresh `/proc`.
The hub service runs with `seccomp=unconfined`, `apparmor=unconfined` and
`systempaths=unconfined` for that; its capabilities stay dropped. Ubuntu 24.04
and later strip the capabilities from unprivileged user namespaces, so on such
a host (including the Ubuntu VM that Colima runs) also turn that restriction
off, and make it persist across reboots:

```sh
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
echo kernel.apparmor_restrict_unprivileged_userns=0 | sudo tee /etc/sysctl.d/60-builder-userns.conf
```

Without it every designer and coder tool call fails with
`sandbox_tool_process_failed: bwrap: No permissions to create a new namespace`
or `bwrap: setting up uid map: Permission denied`.

## Sidecars in Docker

Agents run in sidecars. By default the hub starts them as processes beside
itself, inside the hub container. With `SIDECAR_IMAGE` set, it can also
start them as containers on the Docker daemon at `SIDECAR_DOCKER_HOST`.

```sh
docker build -f deploy/Dockerfile --target sidecar -t corbits-builder-sidecar:local .
docker compose --env-file .env.hub --project-directory . -f deploy/compose.yml -f deploy/compose.docker-sidecars.yml up -d --build
```

- Build the image on the daemon the hub uses; the hub checks that it exists
  when it starts.
- `deploy/compose.docker-sidecars.yml` mounts `/var/run/docker.sock` into the hub and
  adds the socket's group (`DOCKER_SOCKET_GID`: `0` on Docker Desktop, the
  host's `docker` group id on Linux). Access to that socket is root on the
  host.
- Sidecar containers are not on the Compose network. They reach the hub
  through `HUB_API_ORIGIN` and its WebSocket; on Docker Desktop the hub maps
  a loopback origin to `host.docker.internal`. Set `SIDECAR_HUB_WS_URL`
  when that address is not reachable from them.
- Per-container limits: `SIDECAR_MEMORY_BYTES`, `SIDECAR_PIDS`,
  `SIDECAR_NANO_CPUS`.

## Logs

The hub writes JSON lines to stdout at `LOG_LEVEL` (default `info`); an
unknown level stops startup. Set `OTEL_EXPORTER_OTLP_ENDPOINT` (or
`OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`) to also export logs over OpenTelemetry,
with the standard `OTEL_EXPORTER_OTLP_PROTOCOL`, `OTEL_EXPORTER_OTLP_HEADERS`
and `OTEL_SERVICE_NAME` (default: the product name).
