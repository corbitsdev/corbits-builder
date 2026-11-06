import ignore, { type Ignore } from "ignore";
import { type } from "arktype";
import { ApproachesMeta } from "./approaches.ts";
import { AppBundle, DesignBundle } from "./artifact.ts";
import { ProjectExport } from "./project.ts";
import {
  EXCLUDED_DIRECTORIES,
  addBundleFile,
  bundleContent,
  excludedFile,
  utf8Length,
} from "./app-files.ts";

// A person's own directory, usually a git repository, read as the project file the import takes,
// as if Builder had made the project: the code becomes the app document, and the planning
// documents and the design are taken from wherever the directory keeps them. The report names
// each document Builder expects that the directory lacks, for the coordinator to write with the
// person once the project exists, or for whoever runs the import to draft first.

export const REPOSITORY_DOCUMENT_KINDS = [
  "problem_brief",
  "constraints",
  "approaches",
  "product_requirements",
  "design",
  "build_plan",
  "app",
] as const;
export type RepositoryDocumentKind = (typeof REPOSITORY_DOCUMENT_KINDS)[number];
type TextKind = Exclude<RepositoryDocumentKind, "design" | "app">;

export const DOCUMENT_LABELS: Record<RepositoryDocumentKind, string> = {
  problem_brief: "Problem brief",
  constraints: "Constraints",
  approaches: "Approaches",
  product_requirements: "Product requirements",
  design: "Design",
  build_plan: "Build plan",
  app: "App",
};

// Where a directory may keep each text document: an unpacked Builder export (planning/), the
// layout of Builder's seed fixtures (docs/) and a coder workspace's inputs (.inputs/).
const TEXT_PATHS: Record<TextKind, readonly string[]> = {
  problem_brief: [
    "planning/problem_brief.md",
    "docs/problem_brief.md",
    ".inputs/brief.md",
  ],
  constraints: [
    "planning/constraints.md",
    "docs/constraints.md",
    ".inputs/constraints.md",
  ],
  approaches: [
    "planning/approaches.md",
    "docs/approaches.md",
    ".inputs/approaches.md",
  ],
  product_requirements: [
    "planning/product_requirements.md",
    "docs/product_requirements.md",
    ".inputs/requirements.md",
  ],
  build_plan: [
    "planning/build_plan.md",
    "docs/build_plan.md",
    ".inputs/build-plan.md",
  ],
};
const TEXT_KINDS = Object.keys(TEXT_PATHS) as TextKind[];
// Where a directory may keep the design bundle: an unpacked export's design/ or a coder
// workspace's .builder/. Drafts keep it under design/.
const DESIGN_DIRECTORIES = ["design", ".builder"];
// Where the app's package.json may sit: the directory itself, an unpacked export's build/ or
// the seed fixtures' app/.
const APP_DIRECTORIES = ["", "build", "app"];
const PROJECT_FILE = "project.json";
// The scripts the app starter gives a Builder app; the coder and check-app run them.
const STARTER_SCRIPTS = ["dev", "build", "typecheck"];
const TITLE_MAX = 512;
// A file whose name says it holds a secret and that is not source code, which the rules above
// do not already leave out: the person decides, it is only pointed at. Source files named for
// what they handle (password.ts, token.go) are the app's own.
const SECRET_NAME =
  /(secret|token|credential|password|passwd|private|(^|[-_.])key([-_.]|$))/i;
const SOURCE_EXTENSION =
  /\.(c|cc|cpp|cs|css|go|h|hpp|html|java|js|jsx|kt|m|mjs|cjs|php|py|rb|rs|scss|sh|sql|svelte|swift|ts|tsx|vue)$/i;
// Lockfiles of package managers the coder's sandbox does not run; it installs from bun.lock.
const FOREIGN_LOCKFILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
]);

export type RepositoryDocument = ProjectExport["documents"][number];

/** One file of the directory: its path relative to the directory, with / between parts. */
export type RepositoryFile = {
  path: string;
  size: number;
  bytes: () => Promise<Uint8Array>;
};

export type RepositoryImportOptions = {
  /** The directory's own name, the title of last resort. */
  name?: string | undefined;
  /** The project's title, over the one the directory suggests. */
  title?: string | undefined;
  /** The kinds the person approved, or every kind found. */
  approve?: readonly RepositoryDocumentKind[] | "all" | undefined;
  /** App paths to leave out, relative to the directory. */
  exclude?: ReadonlySet<string> | undefined;
  /**
   * Drafted documents, standing over the directory's: <kind>.md and approaches.json at the root
   * or under planning/, a design under design/, files to lay over the app under app/.
   */
  drafts?: readonly RepositoryFile[] | undefined;
  /** Whether the directory's .gitignore files apply; off when git listed the files itself. */
  gitignore?: boolean | undefined;
};

export type RepositoryImportReport = {
  title: string;
  /** Each kind found, with the path it came from. */
  found: Partial<Record<RepositoryDocumentKind, string>>;
  missing: RepositoryDocumentKind[];
  app?: { root: string; files: number; bytes: number } | undefined;
  /** App files the person would likely leave out, each with why, for them to decide. */
  suggested: { path: string; reason: SuggestedReason }[];
  warnings: string[];
};

/** Why a file is suggested for leaving out: it looks like a secret, or it is a lockfile of a package manager the sandbox does not run. */
export type SuggestedReason = "secret" | "lockfile";

export type RepositoryImport = {
  file: ProjectExport;
  report: RepositoryImportReport;
};

type Found = { document: RepositoryDocument; source: string };

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const joined = (directory: string, path: string) =>
  directory ? `${directory}/${path}` : path;
const under = (directory: string, path: string) =>
  directory ? path.startsWith(directory + "/") : true;
const within = (directory: string, path: string) =>
  directory ? path.slice(directory.length + 1) : path;

/** The first Markdown heading, or the YAML front matter's name, names a document. */
export function documentTitle(content: string, fallback: string): string {
  const name = /^---\n(?:.*\n)*?name:\s*"?([^"\n]+?)"?\s*\n(?:.*\n)*?---/.exec(
    content,
  );
  const heading = /^#\s+(.+?)\s*#*\s*$/m.exec(content);
  const title = name?.[1]?.trim() || heading?.[1]?.trim() || fallback;
  return title.slice(0, TITLE_MAX);
}

/** A package name or directory name as a title: "@acme/habit-tracker" becomes "Habit tracker". */
export function humanize(name: string): string {
  const words = name
    .replace(/^@[^/]+\//, "")
    .replace(/[-_.]+/g, " ")
    .trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : name;
}

const parseJson = (text: string | undefined): unknown => {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
};

/** Whether a file's name says it holds a secret, and it is not source code. */
export const looksSecret = (path: string) => {
  const name = basename(path);
  return SECRET_NAME.test(name) && !SOURCE_EXTENSION.test(name);
};

/** Why a file would likely be left out of the app, or undefined when there is no reason to. */
export const suggestedReason = (path: string): SuggestedReason | undefined =>
  FOREIGN_LOCKFILES.has(basename(path))
    ? "lockfile"
    : looksSecret(path)
      ? "secret"
      : undefined;

// The files by path, with each read once as text or bytes.
class Files {
  readonly byPath = new Map<string, RepositoryFile>();
  private readonly texts = new Map<string, Promise<string | undefined>>();
  constructor(files: readonly RepositoryFile[]) {
    for (const file of files) this.byPath.set(file.path, file);
  }
  has(path: string) {
    return this.byPath.has(path);
  }
  paths() {
    return [...this.byPath.keys()].sort();
  }
  // The file's text, or undefined when there is no such file or it is not UTF-8.
  text(path: string): Promise<string | undefined> {
    const file = this.byPath.get(path);
    if (!file) return Promise.resolve(undefined);
    let text = this.texts.get(path);
    if (!text) {
      text = file.bytes().then((bytes) => {
        try {
          return utf8.decode(bytes);
        } catch (error) {
          if (error instanceof TypeError) return undefined;
          throw error;
        }
      });
      this.texts.set(path, text);
    }
    return text;
  }
}

// Which paths the directory's own .gitignore files leave out, as git would: each file's rules
// apply beneath its directory, to the path and to every directory on the way to it.
async function gitignored(files: Files): Promise<(path: string) => boolean> {
  const rules: { base: string; rules: Ignore }[] = [];
  for (const path of files.paths()) {
    if (basename(path) !== ".gitignore") continue;
    const text = await files.text(path);
    if (text === undefined) continue;
    const base = path.slice(0, -".gitignore".length).replace(/\/$/, "");
    rules.push({ base, rules: ignore().add(text) });
  }
  return (path: string) => {
    for (const { base, rules: scoped } of rules) {
      if (!under(base, path)) continue;
      const relativeParts = within(base, path).split("/");
      for (let depth = 1; depth <= relativeParts.length; depth++) {
        const candidate = relativeParts.slice(0, depth).join("/");
        const isDirectory = depth < relativeParts.length;
        if (scoped.ignores(isDirectory ? candidate + "/" : candidate))
          return true;
      }
    }
    return false;
  };
}

const excludedPath = (path: string) =>
  path.split("/").some((segment) => EXCLUDED_DIRECTORIES.has(segment)) ||
  excludedFile(basename(path));

// A root project.json in Builder's own format, as a Builder export unpacked into a repository has.
async function readProjectFile(
  files: Files,
): Promise<ProjectExport | undefined> {
  const file = ProjectExport(parseJson(await files.text(PROJECT_FILE)));
  return file instanceof type.errors ? undefined : file;
}

async function textDocument(
  files: Files,
  kind: TextKind,
  path: string,
): Promise<Found | undefined> {
  const content = await files.text(path);
  if (!content?.trim()) return undefined;
  const document: RepositoryDocument = {
    kind,
    title: documentTitle(content, DOCUMENT_LABELS[kind]),
    content,
    approved: false,
  };
  if (kind === "approaches") {
    const meta = parseJson(await files.text(path.replace(/\.md$/, ".json")));
    if (meta !== undefined) document.approaches = ApproachesMeta.assert(meta);
  }
  return { document, source: path };
}

// The design bundle kept under a directory: DESIGN.md and designs/ with index.html, as the
// designer files it, with every other text file beneath the directory alongside.
async function designDocument(
  files: Files,
  directory: string,
): Promise<Found | undefined> {
  const source = joined(directory, "DESIGN.md");
  if (!files.has(source) || !files.has(joined(directory, "designs/index.html")))
    return undefined;
  const bundled: Record<string, string> = {};
  for (const path of files.paths()) {
    if (!under(directory, path) || excludedPath(within(directory, path)))
      continue;
    const text = await files.text(path);
    if (text !== undefined) bundled[within(directory, path)] = text;
  }
  const bundle = DesignBundle({ files: bundled });
  if (bundle instanceof type.errors) return undefined;
  return {
    document: {
      kind: "design",
      title: documentTitle(bundle.files["DESIGN.md"]!, DOCUMENT_LABELS.design),
      content: JSON.stringify(bundle),
      approved: false,
    },
    source,
  };
}

type Context = {
  files: Files;
  drafts: Files;
  projectFile: ProjectExport | undefined;
  options: RepositoryImportOptions;
};

const fromProjectFile = (
  { projectFile }: Context,
  kind: RepositoryDocumentKind,
): Found | undefined => {
  const document = projectFile?.documents.find((entry) => entry.kind === kind);
  return document ? { document, source: PROJECT_FILE } : undefined;
};

const asDraft = (found: Found | undefined) =>
  found ? { ...found, source: `drafts/${found.source}` } : undefined;

// Text documents and the design in order of standing: the person's drafts, then Builder's own
// project file, then the files kept at the paths a Builder export, a seed fixture or a coder
// workspace uses.
async function readDocuments(
  context: Context,
): Promise<Map<RepositoryDocumentKind, Found>> {
  const { files, drafts } = context;
  const documents = new Map<RepositoryDocumentKind, Found>();
  const first = async (
    source: Files,
    kind: TextKind,
    paths: readonly string[],
  ) => {
    for (const path of paths) {
      const found = await textDocument(source, kind, path);
      if (found) return found;
    }
    return undefined;
  };
  for (const kind of TEXT_KINDS) {
    const found =
      asDraft(
        await first(drafts, kind, [`planning/${kind}.md`, `${kind}.md`]),
      ) ??
      fromProjectFile(context, kind) ??
      (await first(files, kind, TEXT_PATHS[kind]));
    if (found) documents.set(kind, found);
  }
  let design =
    asDraft(await designDocument(drafts, "design")) ??
    fromProjectFile(context, "design");
  for (const directory of DESIGN_DIRECTORIES)
    design ??= await designDocument(files, directory);
  if (design) documents.set("design", design);
  return documents;
}

type AppReading = {
  found?: Found | undefined;
  root?: string | undefined;
  app?: RepositoryImportReport["app"];
  suggested: RepositoryImportReport["suggested"];
  warnings: string[];
};

const count = (bundle: AppBundle) =>
  Object.keys(bundle.files).length + Object.keys(bundle.binary ?? {}).length;

// What a Builder app has that this one lacks, for whoever makes the import to put right.
function appWarnings(files: Readonly<Record<string, string>>): string[] {
  const warnings: string[] = [];
  const manifest = parseJson(files["package.json"]) as
    | { scripts?: Record<string, string> }
    | undefined;
  const scripts = Object.keys(manifest?.scripts ?? {});
  const absent = STARTER_SCRIPTS.filter((name) => !scripts.includes(name));
  const quoted = (names: readonly string[]) =>
    names.map((name) => `"${name}"`).join(", ");
  if (absent.length)
    warnings.push(
      `package.json has no ${quoted(absent)} script; Builder's app starter has ${quoted(STARTER_SCRIPTS)} and the coder runs them`,
    );
  if (!("bun.lock" in files))
    warnings.push(
      "the app has no bun.lock; the coder's sandbox runs bun install --frozen-lockfile, so commit one made with bun install",
    );
  return warnings;
}

// The app is the code as it is now, under the first directory with a package.json, with any
// files drafted under app/ laid over it, so the directory's files stand over the project file's.
async function readApp(context: Context): Promise<AppReading> {
  const { files, drafts, options } = context;
  const root = APP_DIRECTORIES.find((directory) =>
    files.has(joined(directory, "package.json")),
  );
  const overlayPaths = drafts.paths().filter((path) => under("app", path));
  const overlaid = overlayPaths.some((path) => path === "app/package.json");
  if (root === undefined && !overlaid) {
    const filed = fromProjectFile(context, "app");
    if (!filed) return { suggested: [], warnings: [] };
    const bundle = AppBundle.assert(JSON.parse(filed.document.content));
    const bytes = utf8Length(filed.document.content);
    return {
      found: filed,
      app: { root: PROJECT_FILE, files: count(bundle), bytes },
      suggested: [],
      warnings: [],
    };
  }
  const ignored =
    options.gitignore === false ? () => false : await gitignored(files);
  const exclude = options.exclude ?? new Set<string>();
  const collected: Required<AppBundle> = { files: {}, binary: {} };
  const suggested: RepositoryImportReport["suggested"] = [];
  if (root !== undefined)
    for (const path of files.paths()) {
      if (!under(root, path) || exclude.has(path)) continue;
      const relative = within(root, path);
      if (excludedPath(relative) || ignored(path)) continue;
      const reason = suggestedReason(path);
      if (reason) suggested.push({ path, reason });
      addBundleFile(collected, relative, await files.byPath.get(path)!.bytes());
    }
  for (const path of overlayPaths)
    addBundleFile(
      collected,
      within("app", path),
      await drafts.byPath.get(path)!.bytes(),
    );
  const source = root === undefined ? "drafts/app" : root || ".";
  const { bundle, content } = bundleContent(collected);
  return {
    found: {
      document: {
        kind: "app",
        title: DOCUMENT_LABELS.app,
        content,
        approved: false,
      },
      source,
    },
    root,
    app: { root: source, files: count(bundle), bytes: utf8Length(content) },
    suggested,
    warnings: appWarnings(collected.files),
  };
}

// The title given, else the project file's, else the app's package name, else the directory's.
async function readTitle(
  context: Context,
  root: string | undefined,
): Promise<string> {
  const { files, projectFile, options } = context;
  const given = options.title?.trim();
  if (given) return given.slice(0, TITLE_MAX);
  if (projectFile) return projectFile.title;
  const manifest = parseJson(
    await files.text(joined(root ?? "", "package.json")),
  );
  const name = (manifest as { name?: unknown } | undefined)?.name;
  const source =
    typeof name === "string" && name.trim() ? name : (options.name ?? "");
  return humanize(source.trim() || "Project").slice(0, TITLE_MAX);
}

/** Reads a directory's files as a Builder project file and reports what it holds and lacks. */
export async function readRepository(
  files: readonly RepositoryFile[],
  options: RepositoryImportOptions = {},
): Promise<RepositoryImport> {
  const context: Context = {
    files: new Files(files),
    drafts: new Files(options.drafts ?? []),
    projectFile: undefined,
    options,
  };
  context.projectFile = await readProjectFile(context.files);
  const documents = await readDocuments(context);
  const app = await readApp(context);
  if (app.found) documents.set("app", app.found);
  const title = await readTitle(context, app.root);
  const approve = options.approve ?? [];
  const warnings = [...app.warnings];
  if (approve !== "all")
    for (const kind of approve)
      if (!documents.has(kind))
        warnings.push(`${kind} was to be approved but was not found`);
  const list = REPOSITORY_DOCUMENT_KINDS.flatMap((kind) => {
    const entry = documents.get(kind);
    if (!entry) return [];
    const approved = approve === "all" || approve.includes(kind);
    return [{ ...entry.document, approved }];
  });
  const file = ProjectExport.assert({
    format: "corbits-builder.project",
    version: 1,
    title,
    documents: list,
  });
  const found: RepositoryImportReport["found"] = {};
  for (const [kind, entry] of documents) found[kind] = entry.source;
  return {
    file,
    report: {
      title,
      found,
      missing: REPOSITORY_DOCUMENT_KINDS.filter((kind) => !documents.has(kind)),
      app: app.app,
      suggested: app.suggested,
      warnings,
    },
  };
}

/** The report as lines a person or an agent reads. */
export function describeRepositoryImport(
  report: RepositoryImportReport,
): string {
  const number = (value: number) => value.toLocaleString("en-US");
  const lines = [`Title: ${report.title}`];
  for (const kind of REPOSITORY_DOCUMENT_KINDS) {
    if (kind === "app" && report.app)
      lines.push(
        `${kind}: ${report.app.files} files, ${number(report.app.bytes)} bytes, from ${report.app.root}`,
      );
    else lines.push(`${kind}: ${report.found[kind] ?? "missing"}`);
  }
  const why: Record<SuggestedReason, string> = {
    secret: "looks like a secret",
    lockfile: "a lockfile the sandbox does not use",
  };
  for (const { path, reason } of report.suggested)
    lines.push(`consider leaving out ${path}: ${why[reason]}`);
  for (const warning of report.warnings) lines.push(`warning: ${warning}`);
  return lines.join("\n");
}
