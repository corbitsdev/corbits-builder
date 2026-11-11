import { createHash } from "node:crypto";
import { lstat, readFile, readdir, readlink } from "node:fs/promises";
import { resolve } from "node:path";
import manifest from "../vendor/interchange.manifest.json";

// Only what Builder runs is vendored: the packages its own workspaces reach
// through @intx dependencies of any kind (bun install needs every workspace a
// kept one names), without their tests or drizzle-kit's migration snapshots,
// plus the root files the Dockerfile copies.
const ROOT_FILES = new Set([
  "package.json",
  "tsconfig.json",
  "tsconfig.base.json",
  "bunfig.toml",
  "LICENSE",
]);
const NOT_RUN = [
  /\.test[^/]*\.tsx?$/,
  /^packages\/db\/migrations\/meta\/\d+_snapshot\.json$/,
];
const DEPENDENCY_KINDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

async function intxDependencies(packageJson: string): Promise<string[]> {
  const json = JSON.parse(await readFile(packageJson, "utf8"));
  return DEPENDENCY_KINDS.filter((kind) => kind in json)
    .flatMap((kind) => Object.keys(json[kind]))
    .filter((name) => name.startsWith("@intx/"));
}

/** The vendored package and app directories Builder reaches. */
export async function neededVendorDirs(
  repo = resolve(import.meta.dir, ".."),
): Promise<Set<string>> {
  const vendor = resolve(repo, "vendor/interchange");
  const byName = new Map<string, string>();
  for await (const file of new Bun.Glob("{packages,apps}/*/package.json").scan(
    vendor,
  )) {
    const json = JSON.parse(await readFile(resolve(vendor, file), "utf8"));
    byName.set(json.name, file.slice(0, -"/package.json".length));
  }
  const roots = ["package.json"];
  for await (const file of new Bun.Glob(
    "{apps,packages,workflows}/*/package.json",
  ).scan(repo))
    roots.push(file);
  const queue = (
    await Promise.all(
      roots.map((file) => intxDependencies(resolve(repo, file))),
    )
  ).flat();
  const needed = new Set<string>();
  for (let name = queue.pop(); name !== undefined; name = queue.pop()) {
    const dir = byName.get(name);
    if (dir === undefined) throw new Error(`${name} is not vendored`);
    if (needed.has(dir)) continue;
    needed.add(dir);
    queue.push(
      ...(await intxDependencies(resolve(vendor, dir, "package.json"))),
    );
  }
  return needed;
}

export async function verifyVendor(
  root = resolve(import.meta.dir, "../vendor/interchange"),
) {
  const errors: string[] = [];
  const expected = new Set(manifest.files.map((entry) => entry.path));
  const needed = await neededVendorDirs();
  for (const { path } of manifest.files) {
    const kept =
      ROOT_FILES.has(path) ||
      ([...needed].some((dir) => path.startsWith(`${dir}/`)) &&
        !NOT_RUN.some((pattern) => pattern.test(path)));
    if (!kept) errors.push(`not run by Builder: ${path}`);
  }
  for (const entry of manifest.files) {
    try {
      const path = resolve(root, entry.path);
      const stat = await lstat(path);
      const bytes =
        entry.mode === "120000"
          ? Buffer.from(await readlink(path))
          : await readFile(path);
      const actual = createHash("sha1")
        .update(`blob ${bytes.length}\0`)
        .update(bytes)
        .digest("hex");
      if (actual !== entry.blob) errors.push(`modified: ${entry.path}`);
      const executable = (stat.mode & 0o111) !== 0;
      if (entry.mode === "100755" && !executable)
        errors.push(`missing executable mode: ${entry.path}`);
      if (entry.mode === "100644" && executable)
        errors.push(`unexpected executable mode: ${entry.path}`);
      if (stat.isSymbolicLink() !== (entry.mode === "120000"))
        errors.push(`wrong file kind: ${entry.path}`);
    } catch {
      errors.push(`missing or unreadable: ${entry.path}`);
    }
  }
  async function walk(directory: string, prefix = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = prefix + entry.name;
      if (entry.isDirectory() && entry.name === "node_modules") continue;
      if (entry.isDirectory())
        await walk(resolve(directory, entry.name), path + "/");
      else if (!expected.has(path)) errors.push(`unexpected: ${path}`);
    }
  }
  await walk(root);
  return errors;
}

if (import.meta.main) {
  const errors = await verifyVendor();
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  console.log(
    `Verified ${manifest.files.length} upstream files unchanged at ${manifest.revision}`,
  );
}
