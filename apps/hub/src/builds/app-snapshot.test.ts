import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { collectApp, packApp } from "./app-snapshot.ts";

test("the packed app never carries installs, builds, git, the design, env files or outside files", async () => {
  const root = await mkdtemp(join(tmpdir(), "sb-app-snapshot-"));
  const workspace = join(root, "workspace");
  try {
    const files: Record<string, string> = {
      "package.json": "{}",
      ".gitignore": "node_modules/\n",
      "client/src/main.tsx": "export {};\n",
      "node_modules/react/index.js": "module.exports = {};\n",
      "client/node_modules/vite/index.js": "export {};\n",
      "dist/index.html": "<html></html>\n",
      "client/dist/assets/app.js": "export {};\n",
      ".git/HEAD": "ref: refs/heads/main\n",
      ".builder/DESIGN.md": "# Design\n",
      ".env": "SECRET=1\n",
      "server/.env.local": "SECRET=2\n",
      "../home/.bun/install/cache/secret.txt": "home\n",
    };
    for (const [path, content] of Object.entries(files)) {
      await mkdir(dirname(join(workspace, path)), { recursive: true });
      await writeFile(join(workspace, path), content);
    }
    await writeFile(
      join(workspace, "logo.png"),
      new Uint8Array([0x89, 0x50, 0xff, 0xfe]),
    );
    await symlink(join(root, "home"), join(workspace, "home-link"));
    await symlink(
      join(root, "home/.bun/install/cache/secret.txt"),
      join(workspace, "secret.txt"),
    );
    expect(Object.keys(await packApp(workspace)).sort()).toEqual([
      ".gitignore",
      "client/src/main.tsx",
      "package.json",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the collected app keeps binaries and byte-order marks, honors .gitignore and never carries secrets, databases or outside files", async () => {
  const root = await mkdtemp(join(tmpdir(), "sb-app-collect-"));
  const workspace = join(root, "workspace");
  try {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    const files: Record<string, string | Uint8Array> = {
      "package.json": "{}",
      ".gitignore": "*.log\n",
      "client/.gitignore": "generated/\n",
      "client/src/main.tsx": "﻿export {};\n",
      "client/public/logo.png": png,
      "client/generated/out.js": "left out",
      ".env.example": "PORT=3000\n",
      ".env": "SECRET=1\n",
      ".env.local": "SECRET=2\n",
      ".npmrc": "//registry/:_authToken=x\n",
      ".dev.vars": "SECRET=3\n",
      "certs/server.pem": "key\n",
      "certs/server.key": "key\n",
      "certs/client.p12": png,
      "server/app.db": png,
      "server/app.db-wal": png,
      "server/app.db-shm": png,
      "server/data.sqlite3": png,
      "debug.log": "left out",
      "node_modules/react/index.js": "left out",
      "../home/secret.txt": "home\n",
    };
    for (const [path, content] of Object.entries(files)) {
      await mkdir(dirname(join(workspace, path)), { recursive: true });
      await writeFile(join(workspace, path), content);
    }
    await symlink(join(root, "home"), join(workspace, "home-link"));
    await symlink(join(root, "home/secret.txt"), join(workspace, "secret.txt"));
    const bundle = await collectApp(workspace);
    expect(Object.keys(bundle.files).sort()).toEqual([
      ".env.example",
      ".gitignore",
      "client/.gitignore",
      "client/src/main.tsx",
      "package.json",
    ]);
    expect(bundle.files["client/src/main.tsx"]).toBe("﻿export {};\n");
    expect(Object.keys(bundle.binary)).toEqual(["client/public/logo.png"]);
    expect(
      new Uint8Array(
        Buffer.from(bundle.binary["client/public/logo.png"]!, "base64"),
      ),
    ).toEqual(png);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
