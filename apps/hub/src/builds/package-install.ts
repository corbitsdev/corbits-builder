import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type } from "arktype";
import { hasCode } from "@intx/types/has-code";
import type { ToolCall, ToolResult, ToolRunner } from "@intx/types/runtime";
import {
  PACKAGE_INSTALL_TOOL,
  PackageInstallInput,
} from "@corbits-builder/schemas/package-install";

const inputSchema = { ...PackageInstallInput.toJsonSchema() };
export const packageInstallDefinitions = [
  {
    name: PACKAGE_INSTALL_TOOL,
    description:
      "Install npm packages into one package of the app (client, server or packages/<name>) with bun add. When an install is declined, build without those packages.",
    inputSchema,
  },
];

// Matches the shell forms that fetch packages outside the gate. Bare
// `bun install` stays available and is checked against package.json instead.
const FETCHING_COMMAND =
  /(^|[\s;&|(`])((bunx|npx|pnpx)(\s|$)|(npm|pnpm|yarn)\s+(install|i|add|ci|exec|x|dlx|create|update|upgrade|link)(\s|$)|bun\s+(add|a|x|update|upgrade|link|create)(\s|$)|bun\s+(install|i)\s+[^\s;&|-])/;
const BARE_INSTALL = /(^|[\s;&|(`])bun\s+(install|i)(\s|$)/;
export const Manifest = type({
  "name?": "string",
  "dependencies?": "Record<string, string>",
  "devDependencies?": "Record<string, string>",
  "optionalDependencies?": "Record<string, string>",
  "peerDependencies?": "Record<string, string>",
});
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;
const Lockfile = type({ "workspaces?": type({ "[string]": Manifest }) });

/** The packages bun.lock records as installed for some package of the workspace. */
export async function installedPackages(workspace: string) {
  const names = new Set<string>();
  let parsed: unknown;
  try {
    parsed = Bun.JSONC.parse(
      await readFile(join(workspace, "bun.lock"), "utf8"),
    );
  } catch (error) {
    if (
      (hasCode(error) && error.code === "ENOENT") ||
      error instanceof SyntaxError
    )
      return names;
    throw error;
  }
  const lock = Lockfile(parsed);
  if (lock instanceof type.errors) return names;
  for (const manifest of Object.values(lock.workspaces ?? {}))
    for (const field of DEPENDENCY_FIELDS)
      for (const name of Object.keys(manifest[field] ?? {})) names.add(name);
  return names;
}

export function createPackageGate(workspace: string, executor: ToolRunner) {
  const refuse = (call: ToolCall, content: unknown): ToolResult => ({
    callId: call.id,
    content: JSON.stringify(content),
    isError: true,
  });

  return {
    handles: (name: string) => name === PACKAGE_INSTALL_TOOL,
    async refuseShell(call: ToolCall): Promise<ToolResult | undefined> {
      const command = call.arguments["command"];
      if (call.name !== "run_shell" || typeof command !== "string")
        return undefined;
      if (FETCHING_COMMAND.test(command))
        return refuse(call, {
          code: "package_install_refused",
          summary: "Install packages with install_packages, not the shell.",
        });
      if (!BARE_INSTALL.test(command)) return undefined;
      const names = new Set<string>();
      const unregistered = new Set<string>();
      // Bun.Glob matches nothing for a brace pattern whose branches hold a "/", so one per layout.
      const manifests = (
        await Promise.all(
          ["package.json", "*/package.json", "packages/*/package.json"].map(
            (pattern) =>
              Array.fromAsync(
                new Bun.Glob(pattern).scan({ cwd: workspace, onlyFiles: true }),
              ),
          ),
        )
      ).flat();
      for (const path of manifests) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(await readFile(join(workspace, path), "utf8"));
        } catch (error) {
          if (
            (hasCode(error) && error.code === "ENOENT") ||
            error instanceof SyntaxError
          )
            continue;
          throw error;
        }
        const manifest = Manifest(parsed);
        if (manifest instanceof type.errors) continue;
        for (const field of DEPENDENCY_FIELDS)
          for (const [name, spec] of Object.entries(manifest[field] ?? {}))
            if (spec.startsWith("workspace:")) continue;
            // An installed name could otherwise point at any alias, git repository, URL or file.
            else if (/[:/]/.test(spec)) unregistered.add(`${name}@${spec}`);
            else names.add(name);
      }
      if (unregistered.size)
        return refuse(call, {
          code: "package_source_refused",
          packages: [...unregistered],
          summary:
            "Dependencies come from the npm registry by version; these do not.",
        });
      const installed = await installedPackages(workspace);
      const added = [...names].filter((name) => !installed.has(name));
      return added.length
        ? refuse(call, {
            code: "package_install_refused",
            packages: added,
            summary: "Add these packages with install_packages.",
          })
        : undefined;
    },
    async run(call: ToolCall, signal: AbortSignal): Promise<ToolResult> {
      const input = PackageInstallInput(call.arguments);
      if (input instanceof type.errors)
        return refuse(call, {
          code: "invalid_package_input",
          summary: input.summary,
        });
      const result = await executor.run(
        {
          id: call.id,
          name: "run_shell",
          arguments: {
            command: `bun add --exact --cwd ${quote(input.workspace)} ${input.packages.map(quote).join(" ")}`,
          },
        },
        signal,
      );
      return { ...result, callId: call.id };
    },
  };
}
