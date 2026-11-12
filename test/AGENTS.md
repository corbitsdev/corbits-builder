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
  specialist turns in `test/fixtures/pipeline/` through `recorded(...)`.
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
