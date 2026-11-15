import { dirname, join } from "node:path";

export type Found = { root: string; manifest: unknown };

export async function readPlugin(root: string): Promise<Found> {
  return { root, manifest: await Bun.file(join(root, "package.json")).json() };
}

export async function readPluginFolder(plugins: string): Promise<Found[]> {
  const manifests = [
    ...new Bun.Glob("*/package.json").scanSync({ cwd: plugins }),
  ].sort();
  return Promise.all(
    manifests.map((path) => readPlugin(join(plugins, dirname(path)))),
  );
}
