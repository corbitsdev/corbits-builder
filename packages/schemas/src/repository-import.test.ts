import { describe, expect, test } from "bun:test";
import { AppBundle, DesignBundle } from "./artifact.ts";
import { ProjectExport } from "./project.ts";
import {
  describeRepositoryImport,
  documentTitle,
  humanize,
  looksSecret,
  readRepository,
  suggestedReason,
  type RepositoryFile,
} from "./repository-import.ts";

const encoder = new TextEncoder();
const memory = (files: Record<string, string | Uint8Array>): RepositoryFile[] =>
  Object.entries(files).map(([path, content]) => {
    const bytes =
      typeof content === "string" ? encoder.encode(content) : content;
    return { path, size: bytes.length, bytes: () => Promise.resolve(bytes) };
  });

// A person's own app: code, a README, a nested .gitignore, a secret, a binary and the planning
// documents of Builder's seed layout.
const APP = {
  "package.json": JSON.stringify({
    name: "@acme/habit-tracker",
    scripts: { dev: "bun run src/main.ts", build: "bun build src/main.ts" },
  }),
  "README.md": "# Habit tracker\n",
  ".gitignore": "*.log\nbuild-output/\n",
  "src/.gitignore": "generated/\n",
  "src/main.ts": "console.log('hi');\n",
  "src/generated/types.ts": "ignored by the nested file\n",
  "build-output/bundle.js": "ignored\n",
  "debug.log": "ignored\n",
  "node_modules/left/index.js": "never the app's\n",
  ".env": "SECRET=1\n",
  ".env.example": "SECRET=\n",
  "config/deepl-key.txt": "k3y\n",
  "assets/dot.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0xff, 0xfe]),
  "docs/problem_brief.md": "# Problem Brief: Habit tracker\n\n## In short\n",
  "docs/build_plan.md": "# Build Plan: Habit tracker\n\n## Phases\n",
};

describe("readRepository", () => {
  test("files the code as the app, honours .gitignore files and names what is missing", async () => {
    const { file, report } = await readRepository(memory(APP), {
      name: "habit-tracker",
    });
    expect(ProjectExport(file)).toEqual(file);
    expect(report.title).toBe("Habit tracker");
    expect(report.found).toEqual({
      problem_brief: "docs/problem_brief.md",
      build_plan: "docs/build_plan.md",
      app: ".",
    });
    expect(report.missing).toEqual([
      "constraints",
      "approaches",
      "product_requirements",
      "design",
    ]);
    const app = file.documents.find((document) => document.kind === "app")!;
    const bundle = AppBundle.assert(JSON.parse(app.content));
    expect(Object.keys(bundle.files)).toEqual([
      ".env.example",
      ".gitignore",
      "README.md",
      "config/deepl-key.txt",
      "docs/build_plan.md",
      "docs/problem_brief.md",
      "package.json",
      "src/.gitignore",
      "src/main.ts",
    ]);
    expect(Object.keys(bundle.binary ?? {})).toEqual(["assets/dot.png"]);
    expect(report.suggested).toEqual([
      { path: "config/deepl-key.txt", reason: "secret" },
    ]);
    expect(report.app).toEqual({
      root: ".",
      files: 10,
      bytes: report.app!.bytes,
    });
    expect(report.warnings).toEqual([]);
    expect(file.documents.every((document) => !document.approved)).toBe(true);
    const brief = file.documents.find(
      (document) => document.kind === "problem_brief",
    )!;
    expect(brief.title).toBe("Problem Brief: Habit tracker");
    const described = describeRepositoryImport(report);
    expect(described).toContain("constraints: missing");
    expect(described).toContain(
      "consider leaving out config/deepl-key.txt: looks like a secret",
    );
  });

  test("leaves out the paths the person chose and trusts git's own listing", async () => {
    const { file, report } = await readRepository(memory(APP), {
      name: "habit-tracker",
      exclude: new Set(["config/deepl-key.txt", "assets/dot.png"]),
      gitignore: false,
    });
    const bundle = AppBundle.assert(
      JSON.parse(file.documents.find((d) => d.kind === "app")!.content),
    );
    expect(bundle.binary).toBeUndefined();
    expect(Object.keys(bundle.files)).toContain("debug.log");
    expect(Object.keys(bundle.files)).not.toContain("config/deepl-key.txt");
    expect(Object.keys(bundle.files)).not.toContain(".env");
    expect(report.suggested).toEqual([]);
  });

  test("takes drafts over the directory's files, approves named kinds and lays app files over", async () => {
    const drafts = memory({
      "problem_brief.md": "# Brief, revised\n\ntext\n",
      "planning/constraints.md": "# Constraints\n\n- Web only\n",
      "approaches.md": "# Approaches\n\n## Option 1\n",
      "approaches.json": JSON.stringify({
        recommended: "a",
        approaches: [
          {
            id: "a",
            name: "A",
            summary: "s",
            bestFor: "b",
            pros: ["p"],
            cons: ["c"],
            effort: "low",
            risks: [],
          },
          {
            id: "b",
            name: "B",
            summary: "s",
            bestFor: "b",
            pros: ["p"],
            cons: ["c"],
            effort: "high",
            risks: ["r"],
          },
        ],
      }),
      "design/DESIGN.md": '---\nname: "Calm"\n---\n# Design\n',
      "design/designs/index.html": '<main class="app-main"></main>',
      "design/designs/screens/home.html":
        '<section data-screen="home"></section>',
      "app/bun.lock": "{}\n",
    });
    const { file, report } = await readRepository(memory(APP), {
      name: "habit-tracker",
      drafts,
      title: "  Streaks  ",
      approve: ["problem_brief", "design", "product_requirements"],
    });
    expect(report.title).toBe("Streaks");
    expect(report.missing).toEqual(["product_requirements"]);
    expect(report.found.problem_brief).toBe("drafts/problem_brief.md");
    expect(report.found.design).toBe("drafts/design/DESIGN.md");
    expect(report.warnings).toEqual([
      "product_requirements was to be approved but was not found",
    ]);
    const byKind = Object.fromEntries(
      file.documents.map((document) => [document.kind, document]),
    );
    expect(byKind.problem_brief!.content).toBe("# Brief, revised\n\ntext\n");
    expect(byKind.problem_brief!.approved).toBe(true);
    expect(byKind.constraints!.approved).toBe(false);
    expect(byKind.approaches!.approaches?.recommended).toBe("a");
    expect(byKind.design!.title).toBe("Calm");
    expect(byKind.design!.approved).toBe(true);
    expect(
      Object.keys(
        DesignBundle.assert(JSON.parse(byKind.design!.content)).files,
      ).sort(),
    ).toEqual(["DESIGN.md", "designs/index.html", "designs/screens/home.html"]);
    const bundle = AppBundle.assert(JSON.parse(byKind.app!.content));
    expect(bundle.files["bun.lock"]).toBe("{}\n");
  });

  test("reads an unpacked Builder export, with the code under build/ standing over the file's app", async () => {
    const exported = ProjectExport.assert({
      format: "corbits-builder.project",
      version: 1,
      title: "Exported",
      documents: [
        {
          kind: "problem_brief",
          title: "Brief",
          content: "brief",
          approved: true,
        },
        {
          kind: "design",
          title: "Look",
          content: JSON.stringify({
            files: {
              "DESIGN.md": "# Look",
              "designs/index.html": "<main></main>",
            },
          }),
          approved: true,
        },
        {
          kind: "app",
          title: "App",
          content: JSON.stringify({
            files: { "package.json": "{}", "old.ts": "" },
          }),
          approved: false,
        },
      ],
    });
    const unpacked = {
      "project.json": JSON.stringify(exported),
      "planning/problem_brief.md": "# Stale copy\n",
      "planning/constraints.md": "# Constraints from planning\n",
      "build/main.go": "package main\n",
    };
    const { file, report } = await readRepository(memory(unpacked), {
      approve: "all",
    });
    expect(report.title).toBe("Exported");
    expect(report.found).toEqual({
      problem_brief: "project.json",
      constraints: "planning/constraints.md",
      design: "project.json",
      app: "build",
    });
    const byKind = Object.fromEntries(
      file.documents.map((document) => [document.kind, document]),
    );
    expect(byKind.problem_brief!.content).toBe("brief");
    expect(
      Object.keys(AppBundle.assert(JSON.parse(byKind.app!.content)).files),
    ).toEqual(["main.go"]);
    expect(file.documents.every((document) => document.approved)).toBe(true);

    // With no code beside it, the file's own app is what there is.
    const { "build/main.go": _code, ...noCode } = unpacked;
    const again = await readRepository(memory(noCode));
    expect(again.report.found.app).toBe("project.json");
    expect(again.report.app).toEqual({
      root: "project.json",
      files: 2,
      bytes: again.report.app!.bytes,
    });
  });

  test("takes a repository's code whatever it is written in", async () => {
    const { file, report } = await readRepository(
      memory({
        "go.mod": "module example.com/streaks\n",
        "main.go": "package main\n",
        "cmd/serve/serve.go": "package serve\n",
      }),
      { name: "streaks" },
    );
    expect(report.title).toBe("Streaks");
    expect(report.app).toEqual({
      root: ".",
      files: 3,
      bytes: report.app!.bytes,
    });
    const app = file.documents.find((document) => document.kind === "app")!;
    expect(
      Object.keys(AppBundle.assert(JSON.parse(app.content)).files),
    ).toEqual(["cmd/serve/serve.go", "go.mod", "main.go"]);
  });

  test("a directory holding only Builder's documents has no app", async () => {
    const { report } = await readRepository(
      memory({
        ".gitignore": "*.log\n",
        "docs/problem_brief.md": "# Brief\n",
      }),
      { name: "bare-notes" },
    );
    expect(report.title).toBe("Bare notes");
    expect(report.found).toEqual({ problem_brief: "docs/problem_brief.md" });
    expect(report.app).toBeUndefined();
  });
});

describe("names", () => {
  test("titles come from a directory name, a heading or front matter", () => {
    expect(humanize("habit-tracker")).toBe("Habit tracker");
    expect(humanize("my_app.v2")).toBe("My app v2");
    expect(documentTitle("# Heading  \n\ntext", "x")).toBe("Heading");
    expect(documentTitle("no heading", "Fallback")).toBe("Fallback");
    expect(
      documentTitle(
        '---\nname: "Warm (soft)"\ncolors:\n  a: "#fff"\n---\n# Other\n',
        "x",
      ),
    ).toBe("Warm (soft)");
  });

  test("a file's name can say it holds a secret, unless it is source code", () => {
    for (const path of [
      "DEEPL_KEY.txt",
      "config/resend-key.txt",
      "secrets.json",
      "private.pem",
      "passwords.csv",
      "credentials",
    ])
      expect(looksSecret(path)).toBe(true);
    for (const path of [
      "lib/auth/password.ts",
      "lib/token.go",
      "keyboard.ts",
      "src/main.ts",
      "README.md",
      "monkey.png",
    ])
      expect(looksSecret(path)).toBe(false);
    expect(suggestedReason("package-lock.json")).toBe("lockfile");
    expect(suggestedReason("yarn.lock")).toBe("lockfile");
    expect(suggestedReason("bun.lock")).toBeUndefined();
    expect(suggestedReason("api-key.txt")).toBe("secret");
  });
});
