<p align="center">
  <img src="https://github.com/corbitsdev/corbits-builder/raw/main/apps/web/src/assets/corbits-mark.svg" alt="Builder" width="96">
</p>
<h1 align="center">Builder</h1>
<p align="center">Turn a half-baked idea into a working application, without being a developer.</p>
<p align="center">
  <a href="https://github.com/corbitsdev/corbits-builder/actions/workflows/test.yml"><img alt="Tests" src="https://github.com/corbitsdev/corbits-builder/actions/workflows/test.yml/badge.svg"></a>
</p>
<p align="center">
  <a href="https://github.com/corbitsdev/corbits-builder/blob/main/docs/USER_MANUAL.md">User manual</a> ·
  <a href="https://github.com/corbitsdev/corbits-builder/blob/main/docs/SELF_HOST.md">Self-hosting</a> ·
  <a href="https://github.com/corbitsdev/corbits-builder/blob/main/CONTRIBUTING.md">Contributing</a> ·
  <a href="https://github.com/corbitsdev/corbits-builder/blob/main/SECURITY.md">Security</a>
</p>

![Builder](https://github.com/corbitsdev/corbits-builder/raw/main/docs/images/builder.png)

## How it works

1. **Describe it.** Tell the coordinator your idea; it asks what a product
   person would.
2. **Shape it.** It writes a brief, your constraints and a few approaches. You
   pick one, and it fills in the requirements.
3. **Choose a look.** Describe the look you want, or compare design concepts
   side by side.
4. **Build it.** It writes a build plan, then builds the app in a live preview.
5. **Take it.** Download the source, the design and every document.

You approve each document before anything moves on, answer open questions on
question cards, and can ask for changes while the app is being built.

## Quick start

**With your coding agent.** In the folder where you want Builder, run
`npx skills add corbitsdev/corbits-builder`, then tell your agent:

```text
Set up Builder on this machine with the corbits-builder-install skill. Use Docker if I have it, otherwise my own Postgres. Tell me when you need me to do something.
```

**With Docker.**

```sh
mkdir builder && cd builder
base=https://raw.githubusercontent.com/corbitsdev/corbits-builder/main
curl -fsSLO "$base/deploy/compose.yml"
curl -fsSL "$base/.env.hub.example" -o .env.hub   # fill in each line marked Secret
docker compose --env-file .env.hub -f compose.yml up -d
```

Open http://localhost:8000. Ports, logs and running on a server are in
[SELF_HOST.md](https://github.com/corbitsdev/corbits-builder/blob/main/docs/SELF_HOST.md).

**From source**, with [Bun](https://bun.sh) 1.4.4 and Postgres 17: see
[CONTRIBUTING.md](https://github.com/corbitsdev/corbits-builder/blob/main/CONTRIBUTING.md#setup).

Then create an account and connect a model provider: log in with a ChatGPT or
xAI subscription, or add an Anthropic, OpenAI, Google Gemini or xAI API key in
the app or in `.env.hub`
([models](https://github.com/corbitsdev/corbits-builder/blob/main/docs/SELF_HOST.md#models)).

## Docs

- [User manual](https://github.com/corbitsdev/corbits-builder/blob/main/docs/USER_MANUAL.md): using Builder.
- [Self-hosting](https://github.com/corbitsdev/corbits-builder/blob/main/docs/SELF_HOST.md): running it with Docker.
- [Development](https://github.com/corbitsdev/corbits-builder/blob/main/docs/DEV.md) and [Contributing](https://github.com/corbitsdev/corbits-builder/blob/main/CONTRIBUTING.md): working on the code.
- [AGENTS.md](https://github.com/corbitsdev/corbits-builder/blob/main/AGENTS.md): conventions for coding agents.
- [skills/](https://github.com/corbitsdev/corbits-builder/tree/main/skills): agent skills to install Builder and drive it through its API.

Builder runs on [Interchange](https://github.com/faremeter/interchange), which
runs the agents and handles their messages, approvals and credentials.

## License

GPLv2 with the [AI Exception](https://github.com/corbitsdev/corbits-builder/blob/main/GPLv2-AI-Exception.md)
([LICENSE.md](https://github.com/corbitsdev/corbits-builder/blob/main/LICENSE.md)).
Contributions require the [CLA](https://github.com/corbitsdev/corbits-builder/blob/main/CLA.md).
