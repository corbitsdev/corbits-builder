import { $ } from "bun";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type Specs = { [name: string]: string | Specs };

const dependencyFields = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
  "catalog",
  "catalogs",
];

const exactVersion = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const npmAlias = /^npm:(@[\w.-]+\/)?[\w.-]+@\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const workspaceReference = /^workspace:/;
const catalogReference = /^catalog:[\w.-]*$/;
const gitPin =
  /^(git\+\w+:\/\/\S*|git:\/\/\S*|git@\S*|github:\S*|https?:\/\/\S*\.git|[\w.-]+\/[\w.-]+)#[0-9a-f]{40}$/;
const overrideReference = /^\$[\w@/.-]+$/;

function isPinned(spec: string) {
  return (
    exactVersion.test(spec) ||
    npmAlias.test(spec) ||
    workspaceReference.test(spec) ||
    catalogReference.test(spec) ||
    gitPin.test(spec)
  );
}

function isOverridePinned(spec: string) {
  return overrideReference.test(spec) || isPinned(spec);
}

function offenders(
  specs: Specs | undefined,
  allowed: (spec: string) => boolean,
  parent?: string,
): string[] {
  if (specs === undefined) return [];
  return Object.entries(specs).flatMap(([name, spec]) => {
    const label = parent ? `${parent}>${name}` : name;
    if (typeof spec !== "string") return offenders(spec, allowed, label);
    return allowed(spec) ? [] : [`${label}@${spec}`];
  });
}

export async function verifyPins(root = resolve(import.meta.dir, "..")) {
  const listed =
    await $`git ls-files -- package.json '**/package.json' ':!vendor'`
      .cwd(root)
      .text();
  const files = listed.split("\n").filter((file) => file !== "");
  if (files.length === 0) throw new Error("No package.json files are tracked");
  const errors: string[] = [];
  for (const file of files) {
    const manifest = JSON.parse(await readFile(resolve(root, file), "utf8"));
    const found = [
      ...dependencyFields.flatMap((field) =>
        offenders(manifest[field], isPinned),
      ),
      ...offenders(manifest.workspaces?.catalog, isPinned),
      ...offenders(manifest.workspaces?.catalogs, isPinned),
      ...offenders(manifest.overrides, isOverridePinned),
      ...offenders(manifest.resolutions, isOverridePinned),
    ];
    errors.push(...found.map((offender) => `${file}: ${offender}`));
  }
  return { files, errors };
}

if (import.meta.main) {
  const { files, errors } = await verifyPins();
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  console.log(`Verified exact pins in ${files.length} package.json files`);
}
