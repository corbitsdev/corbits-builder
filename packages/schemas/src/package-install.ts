import { type } from "arktype";

export const PACKAGE_INSTALL_TOOL = "install_packages";
// An npm name, optionally with a version or range; never a URL, path or git spec.
const PackageSpec = type(
  /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*(@[A-Za-z0-9.^~<>=*+-]+)?$/,
).atMostLength(214);
// The app is a Bun workspace; a package belongs to the one package that imports it.
export const WorkspacePath = type(
  /^(client|server|packages\/[a-z0-9][a-z0-9-]*)$/,
);
export const PackageInstallInput = type({
  "+": "reject",
  workspace: WorkspacePath,
  packages: PackageSpec.array().atLeastLength(1).atMostLength(20),
});
export type PackageInstallInput = typeof PackageInstallInput.infer;
export const packageName = (spec: string) => spec.replace(/(?<=.)@.*$/, "");
