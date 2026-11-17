import { type } from "arktype";
import { documentSection } from "./in-short.ts";

export const PACKAGE_INSTALL_TOOL = "install_packages";
export const PLANNED_INSTALL_TOOL = "install_planned_packages";
// An npm name, optionally with a version or range; never a URL, path or git spec.
const PackageSpec = type(
  /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*(@[A-Za-z0-9.^~<>=*+-]+)?$/,
).atMostLength(214);
// A package belongs to the one package of the project that imports it: the project itself (.), or
// in a web app's Bun workspace its client, server or a shared package.
export const WorkspacePath = type(
  /^(\.|client|server|packages\/[a-z0-9][a-z0-9-]*)$/,
);
export const PackageInstallInput = type({
  "+": "reject",
  workspace: WorkspacePath,
  packages: PackageSpec.array().atLeastLength(1).atMostLength(20),
});
export type PackageInstallInput = typeof PackageInstallInput.infer;
export const packageName = (spec: string) => spec.replace(/(?<=.)@.*$/, "");
const pinnedVersion = (spec: string) =>
  spec.slice(packageName(spec).length + 1) || undefined;

// The packages the approved version of each of the project's documents declares, by its kind.
export const ApprovedPackages = type({
  documents: type({ kind: "string", packages: "string[]" }).array(),
});
export type ApprovedPackages = typeof ApprovedPackages.infer;

/**
 * The npm packages a document declares in its `## Packages` section: the first code span of each
 * bullet that is a package name, with the version when it pins one.
 */
export function declaredPackages(content: string): string[] {
  const section = documentSection(content, "Packages") ?? "";
  const specs = section
    .split("\n")
    .filter((line) => /^\s*[-*]\s/.test(line))
    .flatMap((line) => {
      const spec = /`([^`]+)`/.exec(line)?.[1];
      return spec !== undefined && PackageSpec.allows(spec) ? [spec] : [];
    });
  return [...new Set(specs)];
}

/**
 * Splits an install into what a declared list covers and what still asks the person: a package it
 * names without a version installs as asked, one it pins installs at that version, asked bare or
 * at the same version; any other package or version asks.
 */
export function plannedInstall(
  requested: readonly string[],
  declared: readonly string[],
) {
  const pins = new Map(
    declared.map((spec) => [packageName(spec), pinnedVersion(spec)]),
  );
  const install: string[] = [];
  const asks: string[] = [];
  for (const spec of requested) {
    const name = packageName(spec);
    const pin = pins.get(name);
    const version = pinnedVersion(spec);
    if (!pins.has(name)) asks.push(spec);
    else if (pin === undefined) install.push(spec);
    else if (version === undefined || version === pin)
      install.push(`${name}@${pin}`);
    else asks.push(spec);
  }
  return { install, asks };
}
