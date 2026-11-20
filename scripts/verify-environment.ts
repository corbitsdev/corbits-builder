import { resolve } from "node:path";
import {
  hubSchema,
  migrationSchema,
  setupSchema,
} from "@corbits-builder/hub/environment";
import { webSchema } from "../apps/web/environment.ts";

// Each example env file documents every variable its process's schemas read, as a set line when
// the variable is required and otherwise as a commented one. The only other variables it may
// document are the ones named here, which a library or another tool reads from the same file.
const examples = [
  {
    file: ".env.hub.example",
    schemas: [hubSchema, migrationSchema, setupSchema],
    others: [
      // The OpenTelemetry exporters.
      "OTEL_EXPORTER_OTLP_HEADERS",
      "OTEL_EXPORTER_OTLP_PROTOCOL",
      "OTEL_RESOURCE_ATTRIBUTES",
      // Docker Compose (deploy/compose*.yml).
      "BUILDER_VERSION",
      "DOCKER_SOCKET_GID",
      // The e2e tests (test/e2e/support/hub.ts).
      "E2E_DB_HOST",
      "E2E_DB_PORT",
      "E2E_DB_USER",
      "E2E_DB_PASSWORD",
    ],
  },
  { file: ".env.web.example", schemas: [webSchema], others: [] },
];

const problems: string[] = [];
for (const { file, schemas, others } of examples) {
  // `NAME=value` is a set variable and `# NAME=value` a documented one left unset.
  const documented = new Map<string, boolean>();
  for (const line of (
    await Bun.file(resolve(import.meta.dir, "..", file)).text()
  ).split("\n")) {
    const match = /^(#\s*)?([A-Z][A-Z0-9_]*)=/.exec(line);
    if (match?.[2]) documented.set(match[2], match[1] === undefined);
  }
  const required = new Map<string, boolean>();
  for (const schema of schemas)
    for (const { key, kind } of schema.in.props)
      required.set(
        String(key),
        required.get(String(key)) || kind === "required",
      );
  for (const [name, needed] of required) {
    const set = documented.get(name);
    if (set === undefined)
      problems.push(`${file}: ${name} is read but not documented`);
    else if (needed && !set)
      problems.push(
        `${file}: ${name} is required, so its line must not be commented`,
      );
  }
  for (const name of documented.keys())
    if (!required.has(name) && !new Set<string>(others).has(name))
      problems.push(`${file}: ${name} is documented but nothing reads it`);
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("The example env files match the environment schemas");
