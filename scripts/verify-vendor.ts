import { createHash } from "node:crypto";
import { lstat, readFile, readdir, readlink } from "node:fs/promises";
import { resolve } from "node:path";
import manifest from "../vendor/interchange.manifest.json";

export async function verifyVendor(
  root = resolve(import.meta.dir, "../vendor/interchange"),
) {
  const errors: string[] = [];
  const expected = new Set(manifest.files.map((entry) => entry.path));
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
