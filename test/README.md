# Tests

Unit tests sit next to the code they test. This folder holds the tests that
cross modules:

- `integration/` checks contracts and architecture across packages; `bun run test` runs it.
- `e2e/` runs the hub against a real Postgres; `bun run test:e2e` runs it.

Later folders, added with their first file: `ux/` for interface tests,
`workflows/` for agent-loop tests, `fixtures/` for recorded model sessions,
`harness/` and `support/` for what those tests share.
