# Building a chat workspace bot

For a bot or app that lives in a team chat workspace. Any other project ignores this pack.

## Use the platform's library

Do not write the chat platform's protocol by hand: request signatures, retries, rate limits and reconnects are where a hand-rolled bot breaks. Use a maintained library for that platform, and name it in the build plan's stack, or in your reply when there is no plan. Before choosing one, check it on the registry with `bun info <name> version`, `bun info <name> time.modified` and `bun info <name> types`: a release in the last few months, its own type definitions, and docs saying it checks request signatures and handles retries and reconnects itself. `@slack/bolt`, `discord.js` and `@microsoft/teams.apps` are examples that are current and typed on the registry today.

## How the bot hears messages

A bot receives events one of two ways: the platform calls a public web address the bot serves, or the bot opens a socket outward to the platform and events arrive on it. Use the outward socket when the platform offers it: it needs no public address, so the bot runs from any computer without a deployment or a tunnel. When the platform offers only the public address, say so in the plan and the hand-back: trying it live then needs a deployment.

## The person's set-up

A bot joins a workspace only as an app registered with the platform, with secrets only the person can create. So the build never shows an "add to workspace" button or link: it cannot work from a local build. Instead, README.md has a Set-up section listing the exact steps in order: register the app on the platform's developer site, the permissions and events to turn on, turning on the socket connection, creating each token, installing the app into their workspace, and which environment variable takes each secret. Mark each step that needs a deployment, such as a public address for events or for installing into other workspaces.

## Secrets

Secrets come from the environment, never from the repository. The entry point reads each one at start and, when any is missing, stops at once with one line naming every missing variable and pointing to the Set-up section. `.env.example` lists the names with no values; `.env` is in `.gitignore`, and Bun loads it by itself. No token goes in code, tests or recorded events.

## The layout

- `src/handlers.ts`, or one file per kind of event: what the bot does with each event, as plain functions that take the event's fields and return the reply, or call a sender passed in. They do not import the library.
- `src/index.ts`: reads the secrets, creates the library's app, registers each handler and connects.
- `fixtures/<event>.json`: one recorded event per kind the bot handles, copied from the platform's documented examples, with made-up ids.
- `src/replay.ts`: feeds each file it is given through the handlers and prints what the bot would send.

The scripts in `package.json`:

```json
"typecheck": "tsc --noEmit",
"test": "bun test",
"build": "bun build src/index.ts --target bun --outdir dist",
"start": "bun src/index.ts",
"replay": "bun src/replay.ts"
```

## CHECKS.txt

```
bun install --frozen-lockfile
bun run typecheck
bun test
bun run build
```

The tests drive the handlers with the recorded events. Nothing in CHECKS.txt needs the network, a token or the real platform.

## Trying it here

Run `bun run replay fixtures/<event>.json` for each kind of event and read what the bot would send; it finishes, so it is an ordinary command. Then start the program with the app runner as `bun run start`: with no secrets here it must stop at once with the line naming each missing variable, which proves it reads its set-up from the environment. It never connects to the real platform from here.

## The hand-back

Say that the bot was tried on recorded events only and never joined a real workspace, and point to README.md's Set-up for what the person does next, naming any step that needs a deployment.
