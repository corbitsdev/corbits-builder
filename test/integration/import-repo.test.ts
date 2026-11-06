import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { AppBundle } from "@corbits-builder/schemas/artifact";
import { ProjectExport } from "@corbits-builder/schemas/project";
import {
  gitPaths,
  importRepository,
  listDirectory,
  parseCliArgs,
} from "../../scripts/import-repo.ts";

const git = (directory: string, ...args: string[]) => {
  const run = Bun.spawnSync(["git", "-C", directory, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (!run.success) throw new Error(run.stderr.toString());
};

async function writeFiles(
  root: string,
  files: Record<string, string | Uint8Array>,
) {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
}

// A person's own app as a repository: code, dependencies and build output git ignores, a secret,
// a binary, a symlink and the planning documents of this repository's seed layout.
const APP_FILES = {
  "package.json": JSON.stringify({
    name: "@acme/habit-tracker",
    scripts: { dev: "bun run src/main.ts", build: "bun build src/main.ts" },
  }),
  "README.md": "# Habit tracker\n",
  ".gitignore": "node_modules/\n*.log\nbuild-output/\n",
  "src/main.ts": "console.log('hi');\n",
  "node_modules/left/index.js": "module.exports = 1;\n",
  "build-output/bundle.js": "ignored\n",
  "debug.log": "ignored\n",
  ".env": "SECRET=1\n",
  "assets/dot.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0xff, 0xfe]),
  "docs/problem_brief.md": "# Problem Brief: Habit tracker\n\n## In short\n",
};

let root: string;
let repo: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "import-repo-"));
  repo = join(root, "habit-tracker");
  await writeFiles(repo, APP_FILES);
  await symlink("/etc/hosts", join(repo, "hosts-link"));
  git(repo, "init", "-q");
});
afterAll(() => rm(root, { recursive: true, force: true }));

describe("listDirectory", () => {
  test("lists what git holds in a repository, regular files only", () => {
    const { files, git: fromGit } = listDirectory(repo);
    expect(fromGit).toBe(true);
    const paths = files.map((file) => file.path);
    expect(paths).toEqual([
      ".env",
      ".gitignore",
      "README.md",
      "assets/dot.png",
      "docs/problem_brief.md",
      "package.json",
      "src/main.ts",
    ]);
    expect(gitPaths(repo)).toContain("hosts-link");
  });

  test("walks a plain directory, never into dependencies", async () => {
    const plain = join(root, "plain");
    await writeFiles(plain, {
      "package.json": "{}",
      "node_modules/x/index.js": "",
      "lib/a.ts": "",
    });
    const { files, git: fromGit } = listDirectory(plain);
    expect(fromGit).toBe(false);
    expect(files.map((file) => file.path)).toEqual([
      "lib/a.ts",
      "package.json",
    ]);
    expect(gitPaths(tmpdir())).toBeUndefined();
  });
});

describe("importRepository", () => {
  test("files a git repository's code as the app and names the documents it lacks", async () => {
    const { file, report } = await importRepository(repo);
    expect(ProjectExport(file)).toEqual(file);
    expect(report.title).toBe("Habit tracker");
    expect(report.found).toEqual({
      problem_brief: "docs/problem_brief.md",
      app: ".",
    });
    expect(report.missing).toEqual([
      "constraints",
      "approaches",
      "product_requirements",
      "design",
      "build_plan",
    ]);
    const app = file.documents.find((document) => document.kind === "app")!;
    const bundle = AppBundle.assert(JSON.parse(app.content));
    expect(Object.keys(bundle.files)).toEqual([
      ".gitignore",
      "README.md",
      "docs/problem_brief.md",
      "package.json",
      "src/main.ts",
    ]);
    expect(Object.keys(bundle.binary ?? {})).toEqual(["assets/dot.png"]);
  });

  test("drafts, approvals and excluded globs reach the reading", async () => {
    const drafts = join(root, "drafts");
    await writeFiles(drafts, {
      "constraints.md": "# Constraints\n",
      "app/bun.lock": "{}\n",
    });
    const { file, report } = await importRepository(repo, {
      drafts,
      title: "Streaks",
      approve: ["constraints"],
      exclude: ["assets/**", "docs/*"],
    });
    expect(report.title).toBe("Streaks");
    expect(report.found.constraints).toBe("drafts/constraints.md");
    const byKind = Object.fromEntries(
      file.documents.map((document) => [document.kind, document]),
    );
    expect(byKind.constraints!.approved).toBe(true);
    expect(byKind.problem_brief!.approved).toBe(false);
    const bundle = AppBundle.assert(JSON.parse(byKind.app!.content));
    expect(Object.keys(bundle.files)).toEqual([
      ".gitignore",
      "README.md",
      "bun.lock",
      "package.json",
      "src/main.ts",
    ]);
    expect(bundle.binary).toBeUndefined();
  });
});

describe("parseCliArgs", () => {
  test("reads the directory, its options and every kind approved", () => {
    expect(
      parseCliArgs([
        "../repo",
        "--approve",
        "problem_brief,design",
        "--exclude",
        "a/**",
        "--exclude",
        "b",
        "--allow-missing",
        "--drafts",
        "d",
        "--title",
        "T",
        "--out",
        "o.json",
      ]),
    ).toEqual({
      directory: "../repo",
      out: "o.json",
      allowMissing: true,
      options: {
        approve: ["problem_brief", "design"],
        exclude: ["a/**", "b"],
        drafts: "d",
        title: "T",
      },
    });
    expect(parseCliArgs(["repo", "--approve", "all"])).toMatchObject({
      out: "repo.project.json",
      options: { approve: "all" },
    });
    expect(parseCliArgs(["--help"])).toBe("help");
  });

  test("refuses what it cannot read", () => {
    expect(() => parseCliArgs([])).toThrow("a directory is needed");
    expect(() => parseCliArgs(["a", "b"])).toThrow("one directory");
    expect(() => parseCliArgs(["a", "--approve", "app,nope"])).toThrow("nope");
    expect(() => parseCliArgs(["a", "--out"])).toThrow("--out needs a value");
    expect(() => parseCliArgs(["a", "--bogus"])).toThrow("unknown option");
  });
});
