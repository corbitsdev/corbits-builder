# Building a desktop app

For a program with its own window on the person's computer. Any other project ignores this pack.

## No window opens here

This workspace has no display, and a desktop runtime does not start in it at all: Electron's binary stops at once for want of system desktop libraries, with or without a headless flag. So build the app so that everything except opening the window runs here: install, typecheck, tests and the production bundle. The window opens only on the person's machine. Do not try to start it here, and do not install a virtual display.

## The stack

Use the stack the person or the build plan names. With none, take the lightest that fits and say why in a sentence:

- Electron: ships Chromium and Node with the app, so it installs from npm, and its build and tests run with Bun and no other toolchain; the app is large. This is the default.
- Tauri: a Rust core and the system's web view, so the app is small; building it needs the Rust toolchain and the platform's web view libraries, which this workspace lacks, so here only its web front end builds and tests.

## The layout (Electron)

- `src/main.ts`: the main process. It creates the window, loads the page and registers an `ipcMain.handle` for each thing the page asks of it; each handler calls into a logic module and holds no logic itself.
- `src/preload.ts`: hands the page a small, typed API with `contextBridge.exposeInMainWorld`, one function per handler. The page never gets Node.
- `src/renderer/index.html` and its scripts: the window's page, which renders and calls the preload's API.
- `src/<name>.ts`: the logic (data, files, rules, calculations) as plain modules that do not import `electron`, each with its test beside it. A test that imports `electron` cannot run here.

Dev dependencies: `electron`, `typescript` and `@types/bun`. Electron's binary downloads on the first start, not at install. The scripts in `package.json`, with `"main": "dist/main.js"` and no `"type": "module"`, since the build writes CommonJS and that setting would make `require` fail:

```json
"build": "bun build src/main.ts src/preload.ts --outdir dist --target node --format cjs --external electron && bun build src/renderer/index.html --outdir dist/renderer",
"typecheck": "tsc --noEmit",
"test": "bun test",
"start": "electron ."
```

## CHECKS.txt

```
bun install --frozen-lockfile
bun run typecheck
bun test
bun run build
```

Never list `bun run start`, `electron` or an installer step: each needs a display or the platform's own tools, and fails here and in Builder's checks.

## Trying it here

Try the logic through its tests. Try the page in a browser: start the program with the app runner as `bun --port 5173 ./src/renderer/index.html`; it has started when its output says `dev server ready` and gives `url: http://localhost:5173/`. Open that address with the browser tools. The preload's API does not exist in a browser, so what calls the main process fails there; check the layout and everything else on the page. The main process itself is tried only on the person's machine.

## README.md

Say how the person runs it on their own computer: install Bun from bun.com, then in the project folder `bun install`, `bun run build` and `bun run start`, which opens the window. Name what they should see first and what to try. Making an installer is a step on the person's machine that this project does not set up; say so when they asked for one.

## The hand-back

Say that the window was never opened here: what was checked (tests, the build, the page in a browser without the main process) and what the person should look at first when they start it.
