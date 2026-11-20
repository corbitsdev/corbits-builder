# Local development

Setup is in
[CONTRIBUTING.md](https://github.com/corbitsdev/corbits-builder/blob/main/CONTRIBUTING.md#setup);
running with Docker Compose is in
[SELF_HOST.md](https://github.com/corbitsdev/corbits-builder/blob/main/docs/SELF_HOST.md).
How a request becomes work is in
[ARCHITECTURE.md](https://github.com/corbitsdev/corbits-builder/blob/main/docs/ARCHITECTURE.md#how-a-request-becomes-work).

## Architecture in brief

| Path                    | What it is                                                                                                                                                                                                                                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vendor/interchange`    | The parts of [Interchange](https://github.com/faremeter/interchange) Builder runs, at the commit in `vendor/VENDORED_REVISION`, plus local patches recorded in `vendor/interchange.manifest.json`. It owns the agent loop, mail, spawning, approvals, credentials, sidecars and run lifecycle. |
| `apps/hub`              | The server: a Postgres control plane, tenancy and sign-in, documents, the coordinator's tools, the plan, project values, checks and the glue that starts each run. It runs Interchange in-process.                                                                                             |
| `packages/client`       | A typed client for the hub's API (`@corbits-builder/client`). It never touches the database or Interchange internals.                                                                                                                                                                          |
| `apps/web`              | The UI: Vite and React over that client, with its own small router in `src/routes.ts`. It compiles every plugin's screen views in when it is built.                                                                                                                                            |
| `workflows/coordinator` | The coordinator's agent, prompt and workflow; the hub supplies its tools.                                                                                                                                                                                                                      |
| `plugins/*`             | One folder per plugin: a specialist with its actions, agents, skills and screens, a ready-made plan, or a skill pack.                                                                                                                                                                          |
| `packages/plugin`       | The plugin contract (`@corbits-builder/plugin`): the `builder` block's types, `defineWorkflow`, `defineScreen`, `defineCheck`, `defineStarter` and the ready-made checks.                                                                                                                      |
| `packages/plugin-host`  | Loads, searches, checks and starts plugins for the hub; the coordinator's tools' logic and how a plan step's state is worked out.                                                                                                                                                              |
| `packages/plugin-ui`    | What a screen's view draws with: the view's props, the card, the actions row, the document block, the comparison, steps and markdown.                                                                                                                                                          |
| `packages/app-checks`   | The check scripts a coding or design workspace runs, which the coder and the designer ship.                                                                                                                                                                                                    |
| `packages/schemas`      | Types and schemas shared by the hub, the client and the plugins.                                                                                                                                                                                                                               |
| `scripts/`              | Dev and verification scripts: pin and vendor checks, the commit check, the Google sign-in emulator, React UI API generation and the repository import (`bun run import:repo`, which writes a directory as a project file the import reads).                                                    |
| `deploy/`               | The Dockerfile and Compose files ([SELF_HOST.md](https://github.com/corbitsdev/corbits-builder/blob/main/docs/SELF_HOST.md)).                                                                                                                                                                  |

Each role runs on the model setting its plugin declares, and the person's
profile maps that setting's tier to a model, so any connected provider can run
any role. The project's conventions are in
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

## Adding a plugin

A plugin is a folder under `plugins/` whose `package.json` has a `builder`
block. The hub reads the folder once when it starts and refuses to start if a
manifest or an action folder is wrong, naming the folder and the field. The
interface compiles the plugins' screens in when it is built. Nothing else
registers a plugin, and no code outside its folder may name it.

A plugin imports the plugin API (`@corbits-builder/plugin`, which holds
`defineWorkflow`, `defineScreen`, `defineCheck` and `defineStarter`), the plugin
UI kit (`@corbits-builder/plugin-ui`, which holds what its screens draw with),
the shared schemas (`@corbits-builder/schemas`) and shared packages such as
`@corbits-builder/app-checks`. It never imports the hub, the web app, the plugin
host or another plugin, and only the hub imports the plugin host. `bun run
boundaries` checks this on every pull request. The reason is that a plugin can
then be added, renamed or removed without touching anything else.

The worker is the smallest real specialist: a manifest, a prompt and one
action, with no code of its own beyond that action's definition. A new
specialist is built the same way.

### The folder and the manifest

```
plugins/worker/
  package.json
  prompt.md
  src/do/definition.ts
```

The worker's `builder` block, from `plugins/worker/package.json` with its
`examples` left out:

```json
"builder": {
  "handle": "worker",
  "runs": "specialist",
  "groups": ["research", "questions", "documents"],
  "when": "The person asks for something no other specialist's action does: research that needs looking things up on the web, a question about the project or its code, or a document such as a competitor analysis, a product comparison or a profit breakdown that needs facts from outside the project.",
  "unless": "Another specialist has an action made for the request, such as one that writes a particular document from the project's own documents, reviews a filed document, builds or changes code, designs a look, or presents the project to an audience.",
  "roles": [
    {
      "name": "worker",
      "label": "Worker",
      "model": "writer",
      "limits": "document",
      "tools": ["read_artifact", "write_artifact", "web"],
      "status": { "working": "Working on it", "done": "Finished" },
      "preferences": ["technical"],
      "filesDocuments": true
    }
  ],
  "settings": {
    "writer": { "label": "Writer", "hint": "Writes the documents.", "tier": "medium" }
  },
  "budgets": {
    "document": { "maxOutputTokens": 32768 }
  },
  "agents": {
    "worker": { "prompt": "./prompt.md" }
  },
  "actions": {
    "do": {
      "reads": ["brand.guidelines", "stack.language"],
      "writes": ["stack.language"],
      "returns": [],
      "start": { "agent": "worker" }
    }
  }
}
```

`handle`, `groups`, `when` and `unless` are what `discover` matches and what
the coordinator reads to choose. `when` says when this is the right move and
`unless` when to leave it alone even though it looks close; both matter, since
the coordinator chooses between plugins from these lines alone. `examples`
lists how a person would ask for it, in their words. `triggers` lists words
that, when a person's message uses them, make the hub add a note pointing the
coordinator at this plugin's screen; it is read only when the hub runs with
`PLUGIN_HINT=triggers`.

`reads` and `writes` name project values, and each must be a value some
installed plugin declares under its own `values`, or the hub refuses to start.
The worker declares none: it reads `brand.guidelines`, which the writer
declares, and `stack.language`, which the coder declares, so a copy of its
manifest needs both of those plugins installed. A plugin that brings its own
value declares it by a dotted name, such as `brand.guidelines`, with `about`
(what it holds, in one line) and `type` (`text`, `json`, `link`, `file`, or a
list of them). A text value may add `pattern`, a regular expression it must
match, and `style`, the design token it lives in once the project has a filed
design; a run cannot write a value that has a `style`.

The role is the worker's agent as the hub runs it. `model` names a model
setting and `limits` an output budget, each declared here or by the hub; a
plugin that shares a setting with another declares it alike, so neither
depends on the other being installed. `tools` picks from the hub's
`read_artifact`, `write_artifact` and `web`. `preferences` are the person's
preferences its assignment carries, by their ids in
`apps/hub/src/config/preferences.ts`.

`agents` asks the host to build an agent from `prompt.md` and the role alone.
An action that starts it with `start: { agent: "worker" }` gets the host's
default starter, whose assignment is the instruction, each other input field
on its own line, what is filed in the project, the kind to file under for each
`filed:` fact the action returns, and the skill packs that apply. A specialist
that needs its own agent code declares `packages` (each a module whose default
export is the workflow and whose named exports are its directors) and
`starters` (each a module whose default export is a `defineStarter`), and its
actions start them with `start: { workflow }`; the writer is the example to
copy.

The manifest also needs the usual package fields and a dependency on the
contract, as the worker's has: `"@corbits-builder/plugin": "workspace:*"`,
`"@corbits-builder/schemas": "workspace:*"` and `"arktype": "catalog:"`. Run
`bun install` after adding the folder, since `plugins/*` is a workspace.

### One action

An action is the folder `src/<action>/`. Its `definition.ts` holds the input
schema and the words the coordinator reads. This is the worker's
`src/do/definition.ts`:

```ts
import { defineWorkflow, Instruction } from "@corbits-builder/plugin";
import { DocumentKind } from "@corbits-builder/schemas/artifact";
import { type } from "arktype";

export default defineWorkflow({
  input: type({
    "+": "reject",
    instruction: Instruction,
    "kind?": DocumentKind,
    "title?": type("string > 0").atMostLength(512),
  }).narrow(
    (task, ctx) =>
      (task.kind === undefined) === (task.title === undefined) ||
      ctx.mustBe("given a kind and a title together, or neither"),
  ),
  describe: {
    summary:
      "Has an agent do the task and report back. The agent can look things up on the web, read the project's documents, attached files and code, and file a document. With a kind and title it files the result as a document under that kind; without them its report is the answer.",
    when: "Nothing else fits the task: research on a company, product or library, a comparison or breakdown with facts from the web, an answer about the project or what its code does. Give a kind and title when the result should be filed as a document; leave them out for a question, whose answer comes back in the reply.",
    unless: "One of the other specialists' actions fits the task.",
    fields: {
      instruction: {
        about:
          "What to do and what to hand back. The agent knows nothing of the conversation, so put in it everything the person said that it needs.",
      },
      kind: {
        about:
          "Only when the result should be filed: a short lowercase slug naming the document, such as competitor_analysis; the same kind revises the filed one. Give title with it.",
      },
      title: {
        about:
          "Only with kind: the document's title as the person will read it.",
      },
    },
  },
});
```

Every field must be described: the type requires it. The descriptions are the
action's guidance in `discover` and the words of every refusal, so write them
for a model that knows nothing but what they say. `Instruction` refuses an
instruction shorter than forty characters, which turns a placeholder into a
refusal the coordinator can act on.

The manifest entry says what the folder cannot. `requires` lists alternatives,
each the facts that together let the action start; `returns` the facts its
finished work makes true; `reads` and `writes` the project values the run is
given and may save; `presents` the screens of the same plugin that show what it
made; `done` the checks of the same plugin that must pass before its reply goes
out. A fact the action needs or makes must be one the hub works out, one a
check returns, or a template on an input field such as `filed:{kind}`; the
catalog refuses any other.

### A screen

An action with a `view.tsx` is a screen. The project plugin's `hand-over` is
the smallest: its manifest entry is `"hand-over": {}`, and its folder holds a
schema, a definition and a view.

`plugins/project/src/hand-over/schema.ts`:

```ts
import { type } from "arktype";

// Who decides the project's approvals: the person, or Builder on their behalf.
const Decides = type("'person' | 'builder'");

// Who decides now, so the screen offers the other way.
export const Input = type({ "+": "reject", decides: Decides });

// Who decides from now on.
export const Output = type({ "+": "reject", decides: Decides });
```

`plugins/project/src/hand-over/definition.ts`:

```ts
import { defineScreen } from "@corbits-builder/plugin";
import { Input, Output } from "./schema.ts";

export default defineScreen({
  input: Input,
  output: Output,
  // The host draws a screen once it is prepared; this one needs nothing past its input.
  prepare: (input) => input,
  describe: {
    says: {
      label: () => "Who decides the approvals",
      chose: (output) =>
        output.decides === "person" ? "You decide" : "Builder decides",
    },
    summary:
      'Tells the person that Builder will carry out each step of the plan without stopping to ask for their approval, with one button to hand their approvals over and one to keep being asked. Opened while approvals are already handed over, it offers to ask them again. The answer is { decides: "builder" } or { decides: "person" }, and Builder has then set the project to match. If they write back instead, what they wrote is their answer.',
    when: "The person says to just build it or to stop asking, or wants to be asked for their approval again.",
    unless:
      "They already answered this screen for what they asked, or they want only one document approved now.",
    fields: {
      decides: {
        about:
          "Who decides approvals now, as the Document approvals line of the person's standing settings says; read_artifact lists those settings.",
        choices: {
          person: "the person approves each document now (Off)",
          builder: "approvals are left to Builder now (On)",
        },
      },
    },
  },
  prefers: {
    agent_decides_approvals: (output) =>
      output.decides === "builder" ? "yes" : "no",
  },
});
```

`prefers` sets a preference for the project from the answer, and the hub does
it when the answer arrives. A screen may also declare `writes`, the project
values its answer saves; `approves`, the documents it approves at the version
shown; `validate`, the fields of a well-typed input it still cannot show;
`data`, the schema of a `data.json` it ships; and `decision`, when its answer is
to accept or send back. Its manifest entry may say what it `requires`, the
values it `reads`, the facts its answer `returns`, `"place": "page"` to open
over the whole room, and what the interface itself supplies it under `host`.

The view is a React component that gets everything as props, typed by
`ScreenViewProps` from `@corbits-builder/plugin-ui/screen`, and never touches
the run or the network. `plugins/project/src/hand-over/view.tsx` draws with the
shared card and actions row so it reads like every other screen:

```tsx
import type { ScreenViewProps } from "@corbits-builder/plugin-ui/screen";
import { Button } from "@corbits/react-ui";

import { ScreenActions } from "@corbits-builder/plugin-ui/screen-actions";
import {
  ScreenCard,
  ScreenSettled,
} from "@corbits-builder/plugin-ui/screen-card";
import type { Input, Output } from "./schema.ts";
import styles from "./view.module.css";

type Decides = (typeof Output.infer)["decides"];
type Props = ScreenViewProps<
  typeof Input.infer,
  typeof Output.infer,
  typeof Input.infer
>;

export const text = {
  title: "Ask before each step?",
  handOver:
    "Builder will carry out each step of the plan without stopping to ask for your approval. You can change anything afterwards, or turn this off at any time.",
  handedOver:
    "Builder is going ahead without asking you. Turn asking back on and it will stop for your approval before each step again.",
  goAhead: "Go ahead without asking",
  keepAsking: "Keep asking me",
  askAgain: "Ask me again",
  keepGoing: "Keep going without asking",
  orWrite: "Or write below what you want instead.",
  settled: (decides: Decides) =>
    decides === "builder"
      ? "No, go ahead without asking"
      : "Yes, ask before each step",
};

export function HandOver({ prepared: { input }, submit, answer }: Props) {
  if (answer !== undefined)
    return (
      <ScreenSettled asked={text.title} answer={text.settled(answer.decides)} />
    );
  const asking = input.decides === "person";
  // The way the person is offered first, then staying as they are.
  const choices: readonly { label: string; decides: Decides }[] = asking
    ? [
        { label: text.goAhead, decides: "builder" },
        { label: text.keepAsking, decides: "person" },
      ]
    : [
        { label: text.askAgain, decides: "person" },
        { label: text.keepGoing, decides: "builder" },
      ];
  return (
    <ScreenCard
      title={text.title}
      actions={
        <ScreenActions note={text.orWrite}>
          {choices.map(({ label, decides }, index) => (
            <Button
              key={decides}
              type="button"
              size="sm"
              variant={index === 0 ? "primary" : "outline"}
              onClick={() => void submit({ decides })}
            >
              {label}
            </Button>
          ))}
        </ScreenActions>
      }
    >
      <p className={styles.about} data-slot="hand-over">
        {asking ? text.handOver : text.handedOver}
      </p>
    </ScreenCard>
  );
}

export default HandOver;
```

A plugin with a view depends on `@corbits-builder/plugin-ui`,
`@corbits/react-ui` and `react` as the project plugin's manifest does.

### Tests and running it

Unit tests sit next to the code they test, such as
`plugins/project/src/setup/definition.test.ts`, and `bun run test` runs every
one under `plugins/`. The hub's catalog tests load the real plugins folder, so
a wrong manifest also fails `bun run test`. Run one file with:

```sh
bun --conditions=intx-src test plugins/project/src/setup/definition.test.ts
```

To try a plugin in a real project, run `bun run dev`. Restart it after adding
or renaming a plugin: the hub reads the folder only when it starts, and the
interface bundles the views only when it builds.

### A skill pack for a specialist

A skill pack is guidance a specialist's agent opens when its work calls for it.
Its whole plugin is a manifest and a folder of markdown files, as
`plugins/rust-skills/package.json` shows:

```json
"builder": {
  "handle": "rust-skills",
  "runs": "skills",
  "extends": "coder",
  "when": "The project is written in Rust, or the work adds Rust code.",
  "skills": "./skills"
}
```

The host lays each pack's files read-only into the agent's workspace under
`.inputs/skills/`, and the assignment lists one line for each pack, its `when`,
so the agent reads only the packs that apply. `extends` names the specialist,
or a pack this one narrows, as `react-router-skills` extends `web-app-skills`;
a narrowing pack sits inside the one it narrows. `actions` limits a pack to
some of the specialist's actions. The coordinator never sees packs.

### A starter for the coder

A starter is code a first build begins from. The coder's starters are declared
under `appStarters` in `plugins/coder/package.json`, and its `build` action
offers each by name. The `bare` starter:

```json
"bare": {
  "about": "A TypeScript project on Bun that is not a web app, such as a command-line tool, a library, a script or a service: one package with tests and no framework.",
  "folder": "starters/bare",
  "setup": "bun install --frozen-lockfile",
  "checks": [
    "bun install --frozen-lockfile",
    "bun run build"
  ],
  "setupFailed": "If it says the lockfile is frozen, bring bun.lock up to date with install_packages, naming the packages the output says changed at the versions package.json gives them."
}
```

`folder` holds the files written as the project's first code; give it an
`AGENTS.md` that tells the coder where each kind of code goes, and a
`CHECKS.txt` that lists the commands proving the code, one per line, as both
starters do. Every coder's reply waits until `check-stack` passes, and
`check-stack` fails when `CHECKS.txt` is missing or empty. `setup` prepares a fresh workspace and `setupFailed` says what an
agent can do when it fails. `checks` are the commands that prove the code; they
are saved as the project's `stack.checks` and run by the coder's `builds` check
before a build or change counts as finished. `run`, when the program serves
something to open in the browser, says how it starts and on which port
variable, as the `web-app` starter's does. No two plugins may declare a starter
of the same name.

### A ready-made plan

A ready-made plan is a manifest and a guidance file. Its steps name other
plugins' actions in order; taking it up copies them onto the project's plan as
one group with their gates. `plugins/build-web-app-express/package.json`:

```json
"builder": {
  "handle": "build-web-app",
  "runs": "plan",
  "groups": ["build", "plan"],
  "when": "The person brings an idea for a site or app that people open in a browser, and wants it planned, designed and built.",
  "unless": "The project already has an app, or the person wants only one piece of the work, such as a mockup.",
  "guidance": "./SKILL.md",
  "steps": [
    { "plugin": "writer", "action": "write-requirements", "title": "Write the requirements", "requires": [] },
    { "plugin": "designer", "action": "mockup", "title": "Design the look", "requires": ["filed:product_requirements"] },
    { "plugin": "writer", "action": "write-build-plan", "title": "Write the build plan", "requires": [] },
    { "plugin": "coder", "action": "build", "title": "Build the app", "requires": [] },
    {
      "plugin": "writer",
      "action": "write",
      "title": "Write the user manual",
      "optional": true,
      "requires": ["app_exists"],
      "input": {
        "kind": "user_manual",
        "title": "User manual",
        "instruction": "Write a user manual for the app as built: what it is for, how to get started, each screen and task step by step in plain words, and answers to the questions a first-time user is likely to ask."
      }
    }
  ],
  "ends": "app_exists"
}
```

A step's `requires` is advice, `optional` lets the person decline it, and
`approval` (`{ "of": ["build_plan", "design"], "when": "optional" }` in
`plugins/build-web-app`) is the one way a step waits for the person; see
[the plan](https://github.com/corbitsdev/corbits-builder/blob/main/docs/ARCHITECTURE.md#the-plan).
`ends` names the fact that ends the plan, after which the project stops
following it. The catalog refuses a step that names an action no installed
plugin with that handle has, a step whose `requires` names a fact only a
screen's answer makes true, and a step the person may not decline that needs a
fact only declinable steps in the same plan make. This plan shares its handle
with `plugins/build-web-app`, which says `"default": true`; a project uses the
one its `plugins.build-web-app` value selects.

### A designer theme

A theme is a folder under `plugins/designer/themes/`, named for its id, with a
`DESIGN.md` of the theme's foundations and a `designs/` folder holding its
`styles.css`, which seeds a design workspace, and an `index.html` sample to
preview it. Copy an existing theme's folder and keep its stylesheet's token
names, which the starter's `DESIGN.md` and the coder rely on. Then add a look
to `design.looks` in `plugins/designer/package.json` that starts from it:

```json
{
  "id": "console",
  "label": "Console",
  "theme": "console",
  "direction": "Dark in both modes, monospace for every figure, a condensed sans for labels, colour only for state and one acid lime action, KPI tiles with sparklines and a live event stream beside a dense table; for monitoring, data and developer tools."
}
```

The coordinator reads the looks in the mockup action's guidance and the
designer reads them in its Looks skill, both from this one list. The catalog
refuses a look whose `theme` is not a folder under `themes/`.

## Tests

```sh
bun run lint
bun run format:check
bun run typecheck
bun run test          # unit and integration tests, plugins included
bun run pins:verify   # pinned dependency versions
bun run vendor:verify # vendored Interchange matches its manifest
bun run test:e2e      # end-to-end tests against an isolated Postgres
```

`bun run test:e2e` reads the `E2E_DB_*` values from `.env.hub`. Start its
throwaway database under its own project name, so it never replaces the
development database:

```sh
docker compose -p builder-e2e --env-file .env.hub --project-directory . -f deploy/compose.test.yml up -d --wait
```

Run one end-to-end file the same way `test:e2e` runs the folder:

```sh
bun --env-file=.env.hub --conditions=intx-src test test/e2e/project-values.test.ts
```

Tests are load-bearing only: invariants and end-to-end behaviour through the
real API ([CONTRIBUTING.md](https://github.com/corbitsdev/corbits-builder/blob/main/CONTRIBUTING.md#rules-worth-knowing),
[test/AGENTS.md](https://github.com/corbitsdev/corbits-builder/blob/main/test/AGENTS.md),
which says how the end-to-end tests are built and how to add one).

The Settings browser tests build the web app and use the real hub with an
isolated test database. Install Chromium once, then run them with the same
`E2E_DB_*` settings as the other end-to-end tests:

```sh
bunx playwright install chromium
bun --env-file=.env.hub --conditions=intx-src test test/e2e/settings.test.ts
```

`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can point to an existing Chromium
installation instead.

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
| `bun run dev:seed`        | Seeds dummy projects (`habit-tracker`, `field-service-dispatch`, `clinical-trial-intake`) at a chosen point in their work.                                                               |
| `bun run import:repo`     | Writes a directory, usually a git repository, as the project file **Import project** reads and names the Builder documents it lacks (`--help` lists the options).                        |
| `bun run vendor:verify`   | Checks `vendor/interchange` matches its pinned upstream commit.                                                                                                                          |
| `bun run skills:react-ui` | Regenerates the designer's `@corbits/react-ui` API reference.                                                                                                                            |

## Environment variables

Each process reads its environment once, at its entry point, through one
ArkType schema in its `environment.ts`: the hub's in
`apps/hub/src/environment.ts` (the server, `db:migrate` and `auth:bootstrap`),
the UI dev server's in `apps/web/environment.ts`, the Google emulator's in
`scripts/environment.ts`. A process that finds anything wrong stops and lists
every variable to fix, never their values. A new variable goes in its schema
and in `.env.hub.example` or `.env.web.example`, as a set line when required
and otherwise commented; `bun run environment:verify` fails until they agree.
`bun run lint` refuses any other `.env` read.

## Migrations

A change to the hub's schema ships as one migration. Edit
`apps/hub/src/db/schema.ts`, then run `bun run db:generate`. The migrator skips
any migration whose journal `when` is not later than the newest one a database
has applied, and `apps/hub/src/db/migrate.test.ts` fails when the journal is
out of order, so a branch that started before another migration merged must
regenerate its own with a later `when`. Never move a `when` that has merged:
databases keep the value they applied.

## Seeding dummy projects

`bun run dev:seed` populates a workspace tenant (defaulting to the first
workspace tenant in Postgres, or creating a local development workspace if the
database is empty) with up to three realistic dummy projects, each with the
documents, design and code filed up to a chosen point (`idea`, `brief`,
`planning`, `design_options`, `designed`, `ready_to_build`, `shipped`), and
gives a workspace with no saved reviewers three demo reviewers:

```sh
bun run dev:seed                                                      # all 3 fixtures at their default points
bun run dev:seed -- --fixture=habit-tracker --stage=planning          # single fixture with planning docs approved
bun run dev:seed -- --fixture=field-service-dispatch --stage=planning --no-approve
bun run dev:seed -- --fixture=clinical-trial-intake --stage=design_options
bun run dev:seed -- --stage=ready_to_build --tenant=<workspaceTenantId>
```

## Where things live

- Product names and user-visible wording: `apps/hub/src/config/` and
  `apps/web/src/config.ts`; what a person reads of a plugin's action, in that
  action's `definition.ts`. The default name is **Builder**.
- Providers, models and profiles: `apps/hub/src/config/models.ts`; each
  model's limits: `apps/hub/src/inference/model-limits.ts`. Each role and the
  model setting it runs on: its plugin's `package.json`, and the coordinator's
  in `apps/hub/src/workflows/coordinator-role.ts`.
- The plugin contract: `packages/plugin/src/index.ts`. The coordinator's tools:
  `apps/hub/src/plugins/tools.ts` over `packages/plugin-host/src/coordinator.ts`,
  with their wording in `packages/plugin-host/src/text.ts`.
- Database schema and migrations: `apps/hub/src/db/`.
- Hub routes: mounted in `apps/hub/src/app.ts`; each project's routes in
  `apps/hub/src/projects/routes.ts` and `apps/hub/src/artifacts/routes.ts`,
  its checks' in `apps/hub/src/plugins/checks.ts`.
- Starting and placing sidecars: `apps/hub/src/provisioning/`,
  `apps/hub/src/sidecar/`.
- The coordinator's prompt: `workflows/coordinator/src/prompt.ts`. A
  specialist's prompt and agent: its plugin folder.
- How the interface draws a plugin's screen:
  `apps/web/src/pages/workspace/screens.ts` and `screen-question.tsx`.
- Interchange docs: [Interchange's](https://github.com/faremeter/interchange) `docs/` folder at the commit in `vendor/VENDORED_REVISION`.
