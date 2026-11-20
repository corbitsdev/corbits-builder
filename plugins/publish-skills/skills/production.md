# Ready to publish

An app is published from its saved code alone, on a machine that has never seen this workspace. Everything below holds wherever it goes.

## stack.production

The project's `stack.production` value says how the app runs where people use it: `install`, `build` and `start` are the commands, run in that order from the app's root on a clean copy of the saved code; `port` is the environment variable the started app answers on; `data` lists the folders, from the app's root, that hold what people entered and are kept from one release to the next. The web-app starter's is `bun install --frozen-lockfile`, `bun run build`, `bun run start` on `PORT`, with `server/data`.

- Prove the three commands before you call the app ready. Builder runs `CHECKS.txt` on the saved code, which covers the frozen install and the build; `check-app` builds and starts a web app from the starter. For anything else, run `build` and then `start` yourself with the port variable set, and open `/api/health` (or the app's page) on it. A command that only works here, because of a file that is not saved, a package installed by hand or a build left over in `dist/`, fails the publish.
- When you change how the app installs, builds, starts or where it keeps data, save the new block with `report_values` as `stack.production`, and keep `stack.checks` and `CHECKS.txt` in step.

## Nothing lives only in development

- Every package the started app imports is a dependency in its `package.json`, not a dev dependency, and `bun.lock` matches.
- `start` serves the built app; it never runs a dev server, a watcher or Vite.
- A file the app reads at run time is saved in the repository or made by `build`. `.env`, `.scratch/` and anything in `.gitignore` do not exist where it is published.

## Data people enter

What people enter is written only inside the folders `stack.production` lists under `data`; every other folder is replaced by each release. Data the app ships with, such as a list of countries, lives in the code (`server/src/data` in the starter), never in a data folder, so a release can change it.

## Accounts

- A demo account whose password is in the code exists only in development. The starter's `seedDemoAccount` (`server/src/demo-account.ts`) creates it only when `NODE_ENV` is not `production`, and `bun run start` sets `NODE_ENV=production`. An app built before that may seed its own copy: make it skip when `NODE_ENV` is `production`, or call the starter's.
- An app with sign-in gives its first real person a way to get an account in production, such as signing up, or a first-run step that makes the first account an owner. Without one, a published app has no way in.

## Configuration

Configuration comes from environment variables read on the server: ports, addresses of other services, keys and secrets. Nothing is hard-coded to this workspace, such as `localhost`, a port number or a path outside the app. `.env.example` lists every variable with no secret values. The app starts with a missing optional variable and stops at once, naming it, when a required one is missing.

## The README

`README.md` says how the app runs in production: the three commands, the port variable, every other environment variable and what it holds, the data folders that must be kept and backed up, and how the first account is made.

## When a publish was held back

The publish's message names the command that failed and its output. Run that command here to see the same failure, fix the cause in the code, prove the three commands again, and say in your reply what was wrong.
