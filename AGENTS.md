# Contributing to Builder

Builder is an app in which a person talks to one coordinator that has
specialists build, write or change what they ask for, on a hub built on
vendored Interchange. Start with
[ARCHITECTURE.md](https://github.com/corbitsdev/corbits-builder/blob/main/docs/ARCHITECTURE.md)
and
[IMPLEMENTATION.md](https://github.com/corbitsdev/corbits-builder/blob/main/docs/IMPLEMENTATION.md);
running it and adding a plugin are in
[DEV.md](https://github.com/corbitsdev/corbits-builder/blob/main/docs/DEV.md)
and sending a change in
[CONTRIBUTING.md](https://github.com/corbitsdev/corbits-builder/blob/main/CONTRIBUTING.md).

The scripts in
[CONTRIBUTING.md](https://github.com/corbitsdev/corbits-builder/blob/main/CONTRIBUTING.md#making-a-change)
and the
[Corbits Triage policy](https://github.com/corbitsdev/corbits-builder/blob/main/.corbits-triage.yml)
enforce most code conventions; run them before saying the tree passes.
These are the ones no check catches:

- Build on Interchange for anything it owns (agents, workflows, tools,
  compaction, mail, approvals, credentials, isolation) rather than
  reimplementing it, and raise what falls between Interchange, Corbits packages
  and Builder before building it
  ([who owns what](https://github.com/corbitsdev/corbits-builder/blob/main/docs/IMPLEMENTATION.md#who-owns-what)).
- A specialist lives entirely in its folder under `plugins/`: its manifest,
  roles, prompt, agent and workflow code, actions, screens, skills, starters
  and themes. The coordinator is the one agent outside it, in
  `workflows/coordinator`.
- The host names no plugin. Code in `apps/`, `packages/` and
  `workflows/coordinator` never imports a plugin or tests for a handle (tests
  and stories may load real plugins as fixtures); what it
  needs to know about a plugin is declared in that plugin's manifest or action
  definitions and read through `@corbits-builder/plugin-host`, which only the
  hub imports.
- A plugin imports the plugin API, the plugin UI kit, the shared schemas and
  shared packages such as `@corbits-builder/app-checks`. It never imports the
  hub, the web app, the plugin host or another plugin (`bun run boundaries`
  checks this), so adding, renaming or removing a plugin changes only its own
  folder
  ([plugins](https://github.com/corbitsdev/corbits-builder/blob/main/docs/DEV.md#adding-a-plugin)).
- The coordinator's tools are fixed. New work is a new plugin action, found
  with `discover` and started with `execute`, not a new tool. A plan is set
  only with the `plan` tool.
- Anything shown to the person for a decision is a screen action, opened with
  `execute`, and its answer is recorded by the hub's answers route. Never have
  an agent report a person's decision.
- Extend the existing module, package, API or component before adding one
  that overlaps it; Builder keeps one way to do each thing. Interface work
  follows [apps/web/AGENTS.md](apps/web/AGENTS.md); end-to-end and integration
  tests follow [test/AGENTS.md](test/AGENTS.md).
- The interface talks to the hub through `@corbits-builder/client`.
- `vendor/interchange` is only added to, never reworded: a change adds what
  Builder needs beside Interchange's own code. Each change is its own
  `(vendor)` commit that also updates `vendor/interchange.manifest.json`, and
  `bun run vendor:verify` fails on anything unrecorded.
- A schema change ships as one migration, generated with `bun run
  db:generate`. Its journal `when` must be later than every migration already
  merged; regenerate it if another merged first, and never move a merged one.
- User-visible wording lives in configuration: `apps/hub/src/config/` for the
  hub and agents, `apps/web/src/config.ts` for the interface, and an action's
  `definition.ts` for what a person reads of that action.
- Secrets stay out of responses, logs, documents and prompts; the interface
  shows only whether a secret is set.
- Conventional Commits (`<type>(<scope>): <description>`), one logical change
  per commit and per pull request.
- Comments explain why, not what the code already says, even where older code
  describes its fields at length.
- A rule or status is defined once and read everywhere else. The plan's shapes
  and its rules for when work is finished live in `@corbits-builder/schemas/plan`;
  `bun run lint` refuses a second test of a step's state for skipped or cancelled.
- Prompts describe the task and the domain. Turn order, reply termination and
  loop detection are the inference loop's job.
