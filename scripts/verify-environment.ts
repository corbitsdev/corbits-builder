import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Variable } from "@corbits-builder/environment";
import {
  readHubEnvironment,
  readMigrationEnvironment,
  readSetupEnvironment,
} from "@corbits-builder/hub/environment";
import { readWebEnvironment } from "@corbits-builder/web/environment";
import { readGoogleEmulatorEnvironment } from "./environment.ts";

// Each example env file documents every variable the schemas of the processes run with it read.
// Besides those, it may name only variables something other than Builder's code reads from the
// same file, listed here by reader.

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
      ...readGoogleEmulatorEnvironment.variables,
    ],
    others: {
      "the OpenTelemetry exporters": [
        "OTEL_EXPORTER_OTLP_HEADERS",
        "OTEL_EXPORTER_OTLP_PROTOCOL",
        "OTEL_RESOURCE_ATTRIBUTES",
      ],
      "Docker Compose (deploy/compose*.yml)": [
        "BUILDER_VERSION",
        "DOCKER_SOCKET_GID",
      ],
      "the end-to-end tests (test/e2e)": [
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

function problems(example: Example, text: string): string[] {
  const lines = documented(text);
  // A variable one schema requires is required in the file, even if another schema defaults it.
  const required = new Map<string, boolean>();
  for (const { name, required: needed } of example.variables)
    required.set(name, (required.get(name) ?? false) || needed);
  const others = new Set(Object.values(example.others).flat());
  const found: string[] = [];
  for (const [name, needed] of required) {
    const line = lines.get(name);
    if (line === undefined) found.push(`${name} is read but not documented`);
    else if (needed && !line.set)
      found.push(`${name} is required, so its line must not be commented`);
  }
  for (const name of lines.keys())
    if (!required.has(name) && !others.has(name))
      found.push(`${name} is documented but nothing reads it`);
  return found.map((problem) => `${example.file}: ${problem}`);
}

const root = resolve(import.meta.dir, "..");
const found: string[] = [];
for (const example of examples)
  found.push(
    ...problems(example, await readFile(resolve(root, example.file), "utf8")),
  );
if (found.length) {
  console.error(found.join("\n"));
  process.exit(1);
}
console.log(
  `Verified ${examples.map(({ file }) => file).join(" and ")} against their environment schemas`,
);
