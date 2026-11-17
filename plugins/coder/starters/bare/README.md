# Project

A TypeScript project on Bun. It greets whoever it is given:

```sh
bun install
bun run start Ada
```

prints `Hello, Ada!`.

## Commands

- `bun run start`: runs `src/index.ts`.
- `bun run test`: runs every `*.test.ts` under `src/`.
- `bun run typecheck`: checks the types.
- `bun run build`: bundles the program into `dist/`.

## Layout

- `src/index.ts`: the program's entry point.
- `src/*.test.ts`: the tests, each beside the code it tests.
