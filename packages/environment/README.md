# Environment

`@corbits-builder/environment`: how a Builder process reads its environment.
Each process describes every variable it reads in one ArkType schema, and
`environment(schema)` gives it a reader that validates the whole environment
at once.

```ts
import { environment, port } from "@corbits-builder/environment";
import { type } from "arktype";

export const readServerEnvironment = environment(
  type({ PORT: port.default("8000"), "HOST?": "string" }),
  {
    derive: ({ PORT, HOST }) => ({ address: `${HOST ?? "localhost"}:${PORT}` }),
  },
);

const { PORT, address } = readServerEnvironment();
```

## Where it fits

This package is the only code that reads `process.env`, `Bun.env` or
`import.meta.env`. Each process keeps its schema in one `environment.ts`, and
only that file imports the package, `inherit` aside. The process's entry
point calls the reader and passes what it returns down.

It reads Node globals, so the interface's browser code never imports it.

## API

- `environment(schema, { problems?, derive? })`: a reader `read(raw?)` that
  validates `raw`, the process's own environment unless given, and returns
  what the schema makes of it, without the variables it does not name. Once
  each variable is valid on its own, `problems(env)` returns the rules across
  variables that do not hold, each as `{ variable, expected }` against the
  variable to change, and `derive(env)` returns fields built from several,
  merged into the result. `read.variables` lists each variable the schema
  declares and whether it must be set.
- `EnvironmentError`: what a reader throws, with one line per problem in
  `problems`. A line names the variable and the rule, such as
  `BETTER_AUTH_SECRET must be at least length 32`, and never the value.
- Pieces for what variables repeat: `flag(fallback)` (`true`, `false`, or
  `fallback` when unset or empty), `positiveInteger`, `port`, `origin` (an
  HTTP(S) origin, read as its origin), `hexKey` (64 hexadecimal characters),
  `list` (comma-separated, trimmed), `trimmed` (blank reads as unset) and
  `filled` (not blank).
- `parseURL(value, protocols)`: `value` as a URL when it parses with one of
  `protocols` and holds no credentials, for a piece of one's own.
- `inherit(names, raw?)` from `@corbits-builder/environment/inherit`: the
  named variables that are set, to hand to a child process, such as `PATH`
  and `HOME`. They are not configuration, so they are copied, not validated,
  and any module that starts a process may use it.

## Working on it

`bun run test` checks every piece here, and that no error repeats a value.
