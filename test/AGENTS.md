# Testing Builder

Unit tests sit next to the code they test. This folder holds cross-package and
end-to-end tests:

- **`test/integration/`:** architecture and boundary checks (package imports,
  vendored Interchange revision, workspace exports) and Builder's contracts
  with vendored Interchange, such as the text its mail delivers. Runs in
  `bun run test` with no database.
- **`test/e2e/`:** end-to-end tests against an isolated Postgres, the real hub
  and real sidecars (`custom-provider.test.ts`, `oauth-model-login.test.ts`,
  `specialist-end-notices.test.ts`, `saved-app.test.ts`, `design-draft.test.ts`,
  `project-values.test.ts` and `directed-change.test.ts`).
- **`test/scenarios/`:** scripted scenarios of the coordinator and its plugins
  (`runner.ts` and one `sNN-*.test.ts` per scenario). They reuse the recorded
  specialist turns in `test/fixtures/pipeline/` through `recorded(...)`. See
  [Scenarios](#scenarios).
- **`test/e2e/support/`:** shared harness (`hub.ts`, and `in-process-hub.ts`
  for a hub that is never served or started, with projects and runs seeded
  straight into its database), the recorded
  OpenAI-compatible model server (`recorded-model.ts` and its unit tests in
  `recorded-model.test.ts`) and the fixture extractor (`extract.ts`).
- **`test/fixtures/pipeline/`:** recorded turns (`scenario.json` and
  `runs/<runKey>/exchanges/<n>/`) replayed by the scenarios and by `directed-change.test.ts`.

## Recorded project replay

The e2e tests and scenarios drive a project through the real hub, sidecars,
approvals, `check_design` and `check-app` by registering `recorded-model.ts` as
a custom OpenAI-compatible provider:

- **Matching (`expect.json`):** each `/v1/chat/completions` turn is matched
  structurally on `lastMessageRole`, `userTextContains`, `requiredTools` and
  `toolResults` (`callId`, `toolName`, `isError`, `keys`, `contains`) rather
  than full prompt text, so ordinary prompt wording edits do not break it.
- **Bindings (`{{bind:<key>}}`):** a tool result in `expect.json` can capture
  live values (`"bind": { "brief_id": "artifactId" }`) and substitute
  `{{bind:brief_id}}` into later `response.sse` turns.
- **Updating the replay:** tool names, tool result keys, specialist task framing,
  approval gates and starter checks are verified during replay. Update the
  scenario's turns, or update `extract.ts` and regenerate the fixtures from a throwaway local run:

```sh
bun --conditions=intx-src test/e2e/support/extract.ts
```

## Running E2E tests

With the `builder-e2e` database running ([docs/DEV.md](../docs/DEV.md#tests)):

```sh
bun run test:e2e
bun --conditions=intx-src test test/e2e/support/recorded-model.test.ts
bun --env-file=.env.hub --conditions=intx-src test test/e2e/custom-provider.test.ts test/e2e/oauth-model-login.test.ts test/e2e/specialist-end-notices.test.ts test/e2e/saved-app.test.ts test/e2e/design-draft.test.ts test/e2e/project-values.test.ts test/e2e/directed-change.test.ts
```

## Scenarios

Each scenario guards one core process end to end, through the real hub and
sidecars, with every model turn scripted. They assert outcomes: stored state, a
gate holding, a record written. Text is asserted only where it is what the
coordinator needs to recover (a refusal naming the wrong field and the valid
choices) or an anchor that finds a control on the page.

- **Starting work:** `s01` a writer files a document of any kind and it is
  approved; `s02` an unknown plugin or action, a missing field and a wrong kind
  are refused with what exists, and the corrected call starts; `s12` a build
  with no documents is refused; `s27` a value the person saved (a link; a bad
  link or plugin selection is refused) reaches both specialists' assignments;
  `s36` a directed change goes to a coder with no approval and is done only
  when the saved app builds; `s40` two installs in one turn are put to the
  person in turn.
- **Gates and approvals:** `s08` an answer that does not fit is refused and the
  question stays open; `s15` a stale approval is refused while a revision runs;
  `s28` a check gates a step; `s29` the person approves from the document and
  the coordinator's token cannot; `s34` the plan's optional steps, declining
  and hand-over.
- **Questions and the plan:** `s06` choosing among concepts in the browser;
  `s07` a typed reply to the font picker changes nothing, then saved fonts
  reach a coder; `s23` the redesign loop on a tagged mockup; `s39` the
  coordinator sets its own plan after a worker looks things up; `s41` the
  plan's question step, and its skip once approvals are handed over.
- **Building:** `s14` the whole build-web-app plan; `s32` "just build it" with
  approvals handed over; `s38` a command-line tool from the bare starter;
  `s42` a library from an empty project.
- **Runs and stopping:** `s11` a writer that gives up and one whose model
  fails; `s16` runs list and wait; `s18` one coder at a time, runs stop and a
  new coder after it.
- **Durability:** `s43` the page shows the same cards and rows of work after a
  reload.

Run them all, one at a time, each in a fresh output folder under a temporary
folder (a filter runs only the files whose names contain it):

```sh
bun run test:scenarios
bun run test:scenarios s43
```

It prints one line per scenario with pass or fail and its seconds, and exits
non-zero if any fail. Each scenario's folder holds `run.log`, and the runner's
`trace.md` and `trace.json`; browser scenarios add screenshots and a video.

Add a scenario only for a core process nothing else guards, unit and e2e tests
included; put a new outcome on the scenario that already sets up its state
rather than starting another hub.
