import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type } from "arktype";
import { hasCode } from "@intx/types/has-code";
import type { ToolCall, ToolResult, ToolRunner } from "@intx/types/runtime";
import {
  type ApprovedPackages,
  PACKAGE_INSTALL_TOOL,
  PackageInstallInput,
  packageName,
  PLANNED_INSTALL_TOOL,
  plannedInstall,
} from "@corbits-builder/schemas/package-install";

const inputSchema = { ...PackageInstallInput.toJsonSchema() };
const WHERE =
  "into the one package of the project that imports them: . for the project itself, or in a web app's workspace client, server or packages/<name>";
export const packageInstallDefinitions = [
  {
    name: PACKAGE_INSTALL_TOOL,
    description: `Install npm packages with bun add ${WHERE}. The person approves each install first, so install a package the approved build plan names with ${PLANNED_INSTALL_TOOL} instead. When an install is declined, build without those packages.`,
    inputSchema,
  },
  {
    name: PLANNED_INSTALL_TOOL,
    description: `Install npm packages the approved build plan names with bun add ${WHERE}, without waiting for the person. A package the plan names without a version installs as given; one it pins installs at that version, so give it bare or at that version. Any other package, or another version, is not installed and waits for the person through ${PACKAGE_INSTALL_TOOL}.`,
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

export function createPackageGate(
  workspace: string,
  executor: ToolRunner,
  approved: (signal: AbortSignal) => Promise<ApprovedPackages>,
) {
  const refuse = (call: ToolCall, content: unknown): ToolResult => ({
    callId: call.id,
    content: JSON.stringify(content),
    isError: true,
  });

  const install = async (
    call: ToolCall,
    input: PackageInstallInput,
    signal: AbortSignal,
  ): Promise<ToolResult> => {
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
  };

  return {
    handles: (name: string) =>
      name === PACKAGE_INSTALL_TOOL || name === PLANNED_INSTALL_TOOL,
    /** Refuses a command line that fetches packages around the gate. */
    async refuseShell(call: ToolCall): Promise<ToolResult | undefined> {
      const command = call.arguments["command"];
      if (typeof command !== "string") return undefined;
      if (FETCHING_COMMAND.test(command))
        return refuse(call, {
          code: "package_install_refused",
          summary:
            "Install packages with install_packages, not the shell, then run what they install with bun run, or with app_status when it keeps running.",
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
      if (call.name === PACKAGE_INSTALL_TOOL)
        return install(call, input, signal);
      const { documents } = await approved(signal);
      const { install: covered, asks } = plannedInstall(
        input.packages,
        documents.flatMap((document) => document.packages),
      );
      if (!covered.length)
        return refuse(call, {
          code: "package_not_planned",
          packages: asks,
          summary: `No approved document names these at this version, so nothing was installed. ${PACKAGE_INSTALL_TOOL} asks the person for them.`,
        });
      const allowedBy = [
        ...new Set(
          documents
            .filter((document) =>
              document.packages.some((spec) =>
                covered.some((name) => packageName(name) === packageName(spec)),
              ),
            )
            .map((document) => document.kind.replaceAll("_", " ")),
        ),
      ].join(" and ");
      const result = await install(
        call,
        { workspace: input.workspace, packages: covered },
        signal,
      );
      // After the output, which a failed install opens with its exit code.
      const allowed = `${covered.join(", ")}: allowed by the approved ${allowedBy}, without asking the person.`;
      const left = asks.length
        ? `\nNot installed: ${asks.join(", ")}, which the approved ${allowedBy} does not name at that version; ${PACKAGE_INSTALL_TOOL} asks the person for them.`
        : "";
      return { ...result, content: `${result.content}\n\n${allowed}${left}` };
    },
  };
}
