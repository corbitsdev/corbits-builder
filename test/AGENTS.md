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
  `design-choice.test.ts` and `pipeline.test.ts`).
- **`test/e2e/support/`:** shared harness (`hub.ts`, and `in-process-hub.ts`
  for a hub that is never served or started, with projects and runs seeded
  straight into its database), the recorded
  OpenAI-compatible model server (`recorded-model.ts` and its unit tests in
  `recorded-model.test.ts`) and the fixture extractor (`extract.ts`).
- **`test/fixtures/pipeline/`:** recorded turns (`scenario.json` and
  `runs/<runKey>/exchanges/<n>/`) replayed by `pipeline.test.ts`.

## Recorded project replay

`pipeline.test.ts` drives a whole project through the real hub, sidecars,
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
  approval gates and starter checks are verified during replay. Update
  declarative approval or artifact steps in `pipeline.test.ts`, or update
  `extract.ts` and regenerate the fixtures from a throwaway local run:

```sh
bun --conditions=intx-src test/e2e/support/extract.ts
```

## Running E2E tests

With the `builder-e2e` database running ([docs/DEV.md](../docs/DEV.md#tests)):

```sh
bun run test:e2e
bun --conditions=intx-src test test/e2e/support/recorded-model.test.ts
bun --env-file=.env.hub --conditions=intx-src test test/e2e/custom-provider.test.ts test/e2e/oauth-model-login.test.ts test/e2e/specialist-end-notices.test.ts test/e2e/saved-app.test.ts test/e2e/design-draft.test.ts test/e2e/design-choice.test.ts
bun --env-file=.env.hub --conditions=intx-src test test/e2e/pipeline.test.ts
```
