import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { DesignBundle } from "@corbits-builder/schemas/artifact";

// Writes a bundle's files under root, skipping any path that would land outside it.
export async function writeBundle<T extends string | Uint8Array>(
  root: string,
  files: Readonly<Record<string, T>>,
) {
  const written: Record<string, T> = {};
  for (const [path, data] of Object.entries(files)) {
    const target = join(root, path);
    if (!target.startsWith(root + sep)) continue;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
    written[path] = data;
  }
  return written;
}

// The coder builds against the design version its task names. It lands in .builder, which the
// coder's sandbox keeps read-only, so only the designer changes it.
export async function unpackDesign(content: string, workspace: string) {
  const { files } = DesignBundle.assert(JSON.parse(content));
  const root = join(workspace, ".builder");
  await rm(root, { recursive: true, force: true });
  return writeBundle(root, files);
}
