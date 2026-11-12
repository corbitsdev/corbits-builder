# Working on this project

A single TypeScript package on Bun, with no framework. It starts as a program that greets a name; replace that with what the task asks for.

- `src/index.ts` is the entry point: `bun run start` runs it and `bun run build` bundles it into `dist/`. Split the code into modules under `src/` as it grows.
- Tests sit beside the code they test as `src/<name>.test.ts` and use `bun:test`. Each thing the project does has a test that fails when it breaks.
- Add a package only when the project needs it, with install_packages.

Whatever the project is (a command-line tool, a library, a script or a service), keep the four scripts in `package.json` working: `start` runs it, `test` runs the tests, `typecheck` checks the types and `build` produces what ships. Change what a script runs when the project needs it, such as a library's build emitting its types.

## Checking the project

`check-project` runs `bun run typecheck`, `bun run test` and `bun run build`, and lists each with what failed. Run it after each step. It does not try the program: run it yourself the way the README says, and check it does what the task asks.

## The README

`README.md` is for whoever installs and uses the project: what it is, how to install and run it, every option, argument or environment variable it takes, with an example of each, and how its code is laid out. Keep it in step with the code; it describes the project as built.

Ports and hosts come from the environment, and paths are relative to the project.
