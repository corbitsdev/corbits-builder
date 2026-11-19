import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Variable } from "@corbits-builder/environment";
import {
  passThrough,
  readHubEnvironment,
  readMigrationEnvironment,
  readSetupEnvironment,
} from "@corbits-builder/hub/environment";
import { readWebEnvironment } from "@corbits-builder/web/environment";

// Each example env file documents every variable its process's schemas read. The only other
// variables it may document are the ones named here: those only a library reads, and those another
// tool reads from the same file.

type Example = Readonly<{
  file: string;
  variables: readonly Variable[];
  others: Readonly<Record<string, readonly string[]>>;
}>;

const examples: readonly Example[] = [
  {
    file: ".env.hub.example",
    variables: [
      ...readHubEnvironment.variables,
      ...readMigrationEnvironment.variables,
      ...readSetupEnvironment.variables,
    ],
    others: {
      "read only by the hub's libraries (passThrough in apps/hub/src/environment.ts)":
        passThrough,
      "read by Docker Compose (deploy/compose*.yml)": [
        "BUILDER_VERSION",
        "DOCKER_SOCKET_GID",
      ],
      "read by the e2e tests (test/e2e/support/hub.ts)": [
        "E2E_DB_HOST",
        "E2E_DB_PORT",
        "E2E_DB_USER",
        "E2E_DB_PASSWORD",
      ],
    },
  },
  {
    file: ".env.web.example",
    variables: readWebEnvironment.variables,
    others: {},
  },
];

// `NAME=value` is a set variable and `# NAME=value` a documented one left unset.
function documented(text: string): Map<string, { set: boolean }> {
  const lines = new Map<string, { set: boolean }>();
  for (const line of text.split("\n")) {
    const match = /^(#\s*)?([A-Z][A-Z0-9_]*)=/.exec(line);
    if (match) lines.set(match[2]!, { set: match[1] === undefined });
  }
  return lines;
}

export function exampleProblems(example: Example, text: string): string[] {
  const lines = documented(text);
  const required = new Map<string, boolean>();
  for (const { name, required: needed } of example.variables)
    required.set(name, (required.get(name) ?? false) || needed);
  const others = new Set(Object.values(example.others).flat());
  const problems: string[] = [];
  for (const [name, needed] of required) {
    const line = lines.get(name);
    if (line === undefined) problems.push(`${name} is read but not documented`);
    else if (needed && !line.set)
      problems.push(`${name} is required, so its line must not be commented`);
  }
  for (const name of lines.keys())
    if (!required.has(name) && !others.has(name))
      problems.push(`${name} is documented but nothing reads it`);
  return problems.map((problem) => `${example.file}: ${problem}`);
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const problems: string[] = [];
  for (const example of examples)
    problems.push(
      ...exampleProblems(
        example,
        await readFile(resolve(root, example.file), "utf8"),
      ),
    );
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log(
    `Verified ${examples.map(({ file }) => file).join(" and ")} against their environment schemas`,
  );
}
