# Testing Builder

Unit tests sit next to the code they test, plugins included
(`plugins/<name>/src/<action>/definition.test.ts`). This folder holds
cross-package and end-to-end tests. A test earns its place only if it would
fail when real behaviour breaks.

- `test/integration/`: architecture and boundary checks (package imports,
  the vendored Interchange revision, workspace exports), Builder's contracts
  with vendored Interchange such as the text its mail delivers, and the dev
  scripts. Runs in `bun run test` with no database.
- `test/e2e/`: end-to-end tests against the real hub and an isolated Postgres
  database created for each run.
- `test/e2e/support/`: the shared harness. `in-process-hub.ts` is the real hub
  in process, migrated onto a fresh database, never served or started, with a
  signed-up person who calls it and helpers that seed projects and runs
  straight into its database. `hub.ts` creates the throwaway database and
  signs up the person the in-process hub uses. `scripted-project.ts` drives
  one project through a served hub with every model turn scripted.
- `test/e2e/builds/`: tests whose runs build an app in the sandbox; CI runs
  them in their own job, which installs the sandbox's system libraries.
- `test/seed/`: the dummy projects `bun run dev:seed` files, which the import
  skill also uses as finished examples.

## How an end-to-end test is built

An end-to-end test drives the hub through its real routes, as the interface
would, and asserts what a person or the coordinator would see: a route's
answer, a stored row, a note mailed to the coordinator. It never calls hub
internals to get past a route.

Most tests start `startInProcessHub()` once in `beforeAll`, seed the project
and runs they need with `seedProject` and `seedRun`, and close the hub in
`afterAll`; `test/e2e/project-values.test.ts` is a short example. Because the
hub is never started, nothing seeded moves on its own, so a test sets up
exactly the state it asserts on. `settings.test.ts` drives the built web app
in a browser over the same in-process hub. A test that needs installed
workflows or a model login builds the hub runtime itself, as
`custom-provider.test.ts` and `oauth-model-login.test.ts` do.

## Adding a test

Put it in `test/e2e/<what-it-proves>.test.ts`, named for the behaviour it
guards. Start from the in-process hub unless the behaviour needs a served hub
or a browser. Seed the least state that reaches the behaviour, assert on what
the person or the coordinator would observe, and close the hub so its database
is dropped.

## Running E2E tests

With the `builder-e2e` database running ([docs/DEV.md](../docs/DEV.md#tests)):

```sh
bun run test:e2e
bun --env-file=.env.hub --conditions=intx-src test test/e2e/project-values.test.ts
```
