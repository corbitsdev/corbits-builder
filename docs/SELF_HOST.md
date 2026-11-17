# Self-host

Running Builder with Docker Compose. Local development with `bun run dev` is
in [DEV.md](https://github.com/corbitsdev/corbits-builder/blob/main/docs/DEV.md).
You need Docker with Compose and an API key or subscription login for at least
one [model provider](#models).

`deploy/compose.yml` runs Postgres 17 and the published hub image, which
applies the migrations, then serves the API and the UI. It needs no clone.

## Install

```sh
mkdir builder && cd builder
base=https://raw.githubusercontent.com/corbitsdev/corbits-builder/main
curl -fsSLO "$base/deploy/compose.yml"
curl -fsSL "$base/.env.hub.example" -o .env.hub
```

Replace `main` with a release tag (`v<version>`) to pin these files to that
release. Every command below runs from this folder.

## Configure

Give each secret `.env.hub` marks its own random value, for example from
`openssl rand -hex 32`; Builder refuses to start without them. Losing or
changing the encryption keys makes stored provider keys unreadable. Every other
setting is optional and described in
[.env.hub.example](https://github.com/corbitsdev/corbits-builder/blob/main/.env.hub.example).

Behind a proxy or on a public domain, set `BETTER_AUTH_BASE_URL` to the URL
people open, and `HUB_PUBLIC_URL`, `HUB_API_ORIGIN` and `UI_PUBLIC_URL` when
they differ from it. If a port is taken, `PORT` moves Builder (default `8000`)
and `DB_PORT` the database (default `5433`). The live preview serves each open
project's app on a port of its own from `LIVE_APP_PORTS` (default `4100-4119`),
which Compose publishes on loopback beside `PORT`; widen the range when more
projects than that have their app open at once.

Builds run in a sandbox that reads only the system's own folders, the
project's workspace and Bun. The coder builds whatever a project is, so a
project in another language, such as Rust, or one that needs another
toolchain, such as one from Homebrew, needs its folders listed in
`SANDBOX_TOOLCHAIN_PATHS`,
separated by `:`, for example `/opt/homebrew`. Builds and the hub's checks of
them read those folders and never write them, and name their programs by full
path. Builder refuses a folder that holds its data folder or sits inside it.
None is listed by default.

`PLUGIN_HINT`, which `.env.hub.example` does not list, has the hub add a note
to each message naming the plugin screens its words suggest, so the
coordinator finds a picker it might otherwise not look for: `triggers` matches
each plugin's trigger words, `fields` its handle, groups, `when`, examples and
descriptions, and `off` (the default) adds nothing. Any other value stops
startup.

`BUILDER_VERSION` picks the published images
(`ghcr.io/corbitsdev/corbits-builder-hub` and `-sidecar`): `rc` (default, the
newest release candidate), `latest` (the newest stable release), `main` (every
merge), an exact version such as `0.1.0-rc.1`, or a full commit sha.

To check that the images were built by Builder's own workflow, verify their
attestations with the [GitHub CLI](https://cli.github.com) before starting,
where `<version>` is the release you run:

```sh
gh attestation verify oci://ghcr.io/corbitsdev/corbits-builder-hub:<version> -R corbitsdev/corbits-builder
gh attestation verify oci://ghcr.io/corbitsdev/corbits-builder-sidecar:<version> -R corbitsdev/corbits-builder
```

A release re-tags images built on `main` without rebuilding them, so the
attestation names `main` as its source, not the release tag.

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
docker compose --env-file .env.hub -f compose.yml up -d          # start
docker compose --env-file .env.hub -f compose.yml logs -f hub    # follow the logs
docker compose --env-file .env.hub -f compose.yml down           # stop, keep the data
```

Open http://localhost:8000 (or your `PORT`), create an account, then add a
provider under **Settings → Providers**, or set a provider key in `.env.hub` before
starting. With one provider, projects run on its profile; with several, each
person picks one under **Settings → Profiles**
([how the choice works](https://github.com/corbitsdev/corbits-builder/blob/main/docs/DEV.md#model-profile-choice)).
To update, or to switch channel after changing `BUILDER_VERSION`, pull the
images and start it again; the hub applies new migrations as it starts:

```sh
docker compose --env-file .env.hub -f compose.yml pull
docker compose --env-file .env.hub -f compose.yml up -d
```

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
docker compose --env-file .env.hub -f compose.yml --profile setup run --rm setup
```

## From source

In a clone, `deploy/compose.build.yml` builds the hub image from the checkout
instead of pulling it. Run from the repo root with `.env.hub` there:

```sh
docker compose --env-file .env.hub --project-directory . -f deploy/compose.yml -f deploy/compose.build.yml up -d --build
```

`bun run docker:up` runs the same.

The plugins are part of the images. The hub reads `plugins/` when it starts,
and the interface compiles each plugin's screens in when it is built, so a
published image runs exactly the plugins it was built with. To add, change or
remove a plugin, make the change in a clone and build the images from it as
above.

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
curl -fsSLO https://raw.githubusercontent.com/corbitsdev/corbits-builder/main/deploy/compose.docker-sidecars.yml
docker compose --env-file .env.hub -f compose.yml -f compose.docker-sidecars.yml up -d
```

- Compose pulls the sidecar image for your `BUILDER_VERSION` before the hub
  starts, and `docker compose pull` refreshes it with the hub. From source, `bun run docker:sidecar` builds
  `corbits-builder-sidecar:local`; set `SIDECAR_IMAGE` to it in `.env.hub`.
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
- `COORDINATOR_START_TIMEOUT_MS` (default `60000`) is the longest a project's
  coordinator may take to start; raise it on a slow machine, but keep it under
  `300000`.

## Logs

The hub writes JSON lines to stdout at `LOG_LEVEL` (default `info`); an
unknown level stops startup. Set `OTEL_EXPORTER_OTLP_ENDPOINT` (or
`OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`) to also export logs over OpenTelemetry,
with the standard `OTEL_EXPORTER_OTLP_PROTOCOL`, `OTEL_EXPORTER_OTLP_HEADERS`
and `OTEL_SERVICE_NAME` (default: the product name).

## Traces

Set `OTEL_EXPORTER_OTLP_ENDPOINT` (or `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` to
send traces without logs) and the hub exports what every agent does as
OpenTelemetry traces: one trace per agent turn, with a span for each model call
and each tool call. Spans use OpenTelemetry's generative AI names, so tools such
as Langfuse read the model, token counts and tool names without extra setup.
Each span also says which project, agent role, model profile, reasoning effort
and agent package version produced it, and a project's turns share one session.
With no endpoint set, nothing is exported.

- `OTEL_EXPORTER_OTLP_HEADERS` carries the receiver's credentials.
- `OTEL_RESOURCE_ATTRIBUTES` names the deployment on every trace, for example
  `deployment.environment.name=staging,service.instance.id=builder-1,vcs.ref.head.revision=<commit>`.
- `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true` also sends each
  model reply (text, tool calls with names and arguments, and provider-returned
  reasoning text) and each tool's arguments and result; model inputs are absent
  because run events do not carry the conversation sent to the model.
  Leave it off unless the receiver may hold project content.

For Langfuse, the endpoint is `<langfuse>/api/public/otel` and the headers are
`Authorization=Basic <base64 of public key:secret key>,x-langfuse-ingestion-version=4`.
