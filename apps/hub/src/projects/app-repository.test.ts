import { expect, test } from "bun:test";
import fs from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import git from "isomorphic-git";
import { appRepositoryMain } from "./app-repository.ts";

const author = { name: "Builder", email: "builder@example.com" };

test("an app repository's main reads as the app a snapshot would file, once it holds one", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sb-app-repository-"));
  try {
    await git.init({ fs, dir, defaultBranch: "main" });
    const commit = async (files: Record<string, string | Uint8Array>) => {
      for (const [path, content] of Object.entries(files)) {
        await mkdir(dirname(join(dir, path)), { recursive: true });
        await writeFile(join(dir, path), content);
        await git.add({ fs, dir, filepath: path });
      }
      return git.commit({ fs, dir, message: "Edit", author });
    };
    const genesis = await commit({ ".gitignore": "node_modules/\n" });
    const atGenesis = await appRepositoryMain(dir);
    expect(atGenesis.commit).toBe(genesis);
    expect(await atGenesis.read()).toBeUndefined();

    const head = await commit({
      "package.json": "{}",
      "src/main.tsx": "export {};\n",
      "public/logo.png": new Uint8Array([0x89, 0x50, 0xff, 0xfe]),
      "node_modules/react/index.js": "module.exports = {};\n",
      ".builder/DESIGN.md": "# Design\n",
      "server/.env.local": "SECRET=1\n",
    });
    const main = await appRepositoryMain(dir);
    expect(main.commit).toBe(head);
    expect(main.committedAt.getTime()).toBeGreaterThan(0);
    const app = await main.read();
    expect(Object.keys(app!.bundle.files).sort()).toEqual([
      ".gitignore",
      "package.json",
      "src/main.tsx",
    ]);
    expect(app!.bundle.binary).toEqual({ "public/logo.png": "iVD//g==" });
    expect(JSON.parse(app!.content)).toEqual(app!.bundle);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
