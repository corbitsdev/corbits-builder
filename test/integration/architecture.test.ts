import { expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import manifest from "../../vendor/interchange.manifest.json";
import packageJson from "../../package.json";

const root = resolve(import.meta.dir, "../..");
async function sources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .filter((entry) => !["node_modules", "dist"].includes(entry.name))
      .map(async (entry) => {
        const path = resolve(directory, entry.name);
        return entry.isDirectory()
          ? sources(path)
          : /\.[cm]?[jt]sx?$/.test(path)
            ? [path]
            : [];
      }),
  );
  return nested.flat();
}

test("code imports Interchange by package name, and the interface never imports the server", async () => {
  for (const directory of ["apps", "packages", "workflows"]) {
    for (const path of await sources(resolve(root, directory))) {
      const content = await readFile(path, "utf8");
      expect(content).not.toMatch(
        /(?:from\s*|import\s*\(|require\s*\()\s*["'][^"']*vendor\/interchange/,
      );
      if (path.includes("/apps/web/"))
        expect(content).not.toMatch(
          /(?:from\s*|import\s*\()\s*["'](?:postgres|drizzle-orm|@corbits-builder\/hub(?:\/|["'])|[^"']*apps\/hub)/,
        );
    }
  }
});

test("the vendored revision matches its manifest", async () => {
  expect(
    (await readFile(resolve(root, "vendor/VENDORED_REVISION"), "utf8")).trim(),
  ).toBe(manifest.revision);
});

test("workspace imports use declared package exports and local dependencies", async () => {
  const workspacePaths = await Promise.all(
    (packageJson.workspaces as string[])
      .map((pattern) =>
        pattern.endsWith("/package.json") ? pattern : `${pattern}/package.json`,
      )
      .flatMap((pattern) => [...new Bun.Glob(pattern).scanSync({ cwd: root })]),
  );
  const workspaces = await Promise.all(
    workspacePaths.map(async (path) => ({
      directory: resolve(root, dirname(path)),
      manifest: await Bun.file(resolve(root, path)).json(),
    })),
  );
  const owner = (path: string) =>
    workspaces.find(({ directory }) => path.startsWith(directory + "/"));
  for (const directory of [
    "apps",
    "packages",
    "workflows",
    "test",
    "scripts",
  ]) {
    for (const path of await sources(resolve(root, directory))) {
      const consumer = owner(path)?.manifest ?? packageJson;
      for (const match of (await readFile(path, "utf8")).matchAll(
        /(?:from\s+|import\s*\(\s*|import\s+)["']([^"'\n]+)["']/g,
      )) {
        const specifier = match[1]!;
        if (specifier.startsWith(".")) {
          const destination = owner(resolve(dirname(path), specifier));
          expect(
            !destination || destination.manifest.name === consumer.name,
          ).toBe(true);
        } else if (specifier.startsWith("@corbits-builder/")) {
          const name = specifier.split("/").slice(0, 2).join("/");
          const dependencies = {
            ...consumer.dependencies,
            ...consumer.devDependencies,
          };
          expect(dependencies[name]).toBe("workspace:*");
          expect(
            owner(Bun.resolveSync(specifier, dirname(path)))?.manifest.name,
          ).toBe(name);
        }
      }
    }
  }
});
