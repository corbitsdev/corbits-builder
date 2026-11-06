import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { EXCLUDED_DIRECTORIES } from "@corbits-builder/schemas/app-files";
import {
  REPOSITORY_DOCUMENT_KINDS,
  describeRepositoryImport,
  readRepository,
  type RepositoryDocumentKind,
  type RepositoryFile,
  type RepositoryImportOptions,
} from "@corbits-builder/schemas/repository-import";

// Writes a directory, usually a git repository, as the project file Builder's import reads, as
// if Builder had made the project itself, and reports which of Builder's documents it lacks so
// whoever runs this can draft them, have the person approve them and run again with --drafts.
// The reading itself is the schemas' repository import, which the UI's folder import shares;
// this script only lists the files, with git when the directory is a repository.

const statOf = (path: string) => lstatSync(path, { throwIfNoEntry: false });
const isRegularFile = (path: string) => statOf(path)?.isFile() === true;
const isDirectory = (path: string) => statOf(path)?.isDirectory() === true;
const posix = (path: string) => path.split(sep).join("/");

const fileOf = (root: string, path: string): RepositoryFile => ({
  path: posix(path),
  size: statOf(join(root, path))?.size ?? 0,
  bytes: () => Promise.resolve(new Uint8Array(readFileSync(join(root, path)))),
});

// The paths git holds for the directory, tracked or untracked and not ignored, or undefined when
// the directory is not a git work tree or git is not installed.
export function gitPaths(directory: string): string[] | undefined {
  if (!Bun.which("git")) return undefined;
  const inside = Bun.spawnSync(
    ["git", "-C", directory, "rev-parse", "--is-inside-work-tree"],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (!inside.success || inside.stdout.toString().trim() !== "true")
    return undefined;
  const listed = Bun.spawnSync(
    [
      "git",
      "-C",
      directory,
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (!listed.success) return undefined;
  return [
    ...new Set(listed.stdout.toString().split("\0").filter(Boolean)),
  ].sort();
}

// Every regular file beneath a directory, except under the directories the app never keeps.
function walkPaths(root: string, directory = ""): string[] {
  const paths: string[] = [];
  const entries = readdirSync(join(root, directory), { withFileTypes: true });
  for (const entry of entries) {
    const path = directory ? join(directory, entry.name) : entry.name;
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry.name))
        paths.push(...walkPaths(root, path));
    } else if (entry.isFile()) paths.push(path);
  }
  return paths.sort();
}

/** The directory's files: what git holds when it is a repository, else every regular file. */
export function listDirectory(directory: string): {
  files: RepositoryFile[];
  git: boolean;
} {
  const root = realpathSync(directory);
  const fromGit = gitPaths(root);
  // A symlink, a submodule or a file deleted since it was staged is not the directory's own file.
  const paths = (fromGit ?? walkPaths(root)).filter((path) =>
    isRegularFile(join(root, path)),
  );
  return {
    files: paths.map((path) => fileOf(root, path)),
    git: fromGit !== undefined,
  };
}

export type ImportOptions = {
  /** A directory of drafted documents, laid out as the planning/ and design/ of an export. */
  drafts?: string | undefined;
  title?: string | undefined;
  approve?: readonly RepositoryDocumentKind[] | "all" | undefined;
  /** Globs of app paths to leave out, relative to the directory. */
  exclude?: readonly string[] | undefined;
};

/** Reads a directory as a Builder project file and reports what it holds and lacks. */
export async function importRepository(
  directory: string,
  options: ImportOptions = {},
) {
  const root = realpathSync(directory);
  const { files, git } = listDirectory(root);
  const globs = (options.exclude ?? []).map((pattern) => new Bun.Glob(pattern));
  const exclude = new Set(
    files
      .map(({ path }) => path)
      .filter((path) => globs.some((glob) => glob.match(path))),
  );
  const reading: RepositoryImportOptions = {
    name: basename(root),
    title: options.title,
    approve: options.approve,
    exclude,
    gitignore: !git,
    drafts: options.drafts ? listDirectory(options.drafts).files : undefined,
  };
  return readRepository(files, reading);
}

export const usage = `Usage: bun run import:repo <directory> [options]

Writes the directory as a Builder project file (the file "Import project" reads) and reports
which of Builder's documents it lacks.

Options:
  --out <file>          Where to write the project file (default: <directory name>.project.json)
  --drafts <dir>        Drafted documents: <kind>.md (and approaches.json) at its root or under
                        planning/, a design under design/, files to add to the app under app/
  --title <title>       The project's title
  --approve <kinds>     Mark these kinds approved: a comma-separated list, or "all"
  --exclude <glob>      Leave matching app paths out; may repeat
  --allow-missing       Exit 0 even when documents are missing
  --help                Show this text

Kinds: ${REPOSITORY_DOCUMENT_KINDS.join(", ")}`;

export type CliArgs = {
  directory: string;
  out: string;
  allowMissing: boolean;
  options: ImportOptions;
};

const parseApprove = (kinds: string): ImportOptions["approve"] => {
  if (kinds === "all") return "all";
  const named = kinds.split(",").map((kind) => kind.trim());
  const unknown = named.find(
    (kind) =>
      !REPOSITORY_DOCUMENT_KINDS.includes(kind as RepositoryDocumentKind),
  );
  if (unknown !== undefined)
    throw new Error(
      `--approve names an unknown kind: ${unknown}. Kinds: ${REPOSITORY_DOCUMENT_KINDS.join(", ")}`,
    );
  return named as RepositoryDocumentKind[];
};

export function parseCliArgs(argv: readonly string[]): CliArgs | "help" {
  let directory: string | undefined;
  let out: string | undefined;
  let allowMissing = false;
  const options: ImportOptions = {};
  const exclude: string[] = [];
  const value = (index: number, flag: string) => {
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--"))
      throw new Error(`${flag} needs a value`);
    return next;
  };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]!;
    switch (argument) {
      case "--help":
      case "-h":
        return "help";
      case "--out":
        out = value(index++, argument);
        break;
      case "--drafts":
        options.drafts = value(index++, argument);
        break;
      case "--title":
        options.title = value(index++, argument);
        break;
      case "--exclude":
        exclude.push(value(index++, argument));
        break;
      case "--allow-missing":
        allowMissing = true;
        break;
      case "--approve":
        options.approve = parseApprove(value(index++, argument));
        break;
      default:
        if (argument.startsWith("--"))
          throw new Error(`unknown option ${argument}`);
        if (directory !== undefined) throw new Error("one directory at a time");
        directory = argument;
    }
  }
  if (directory === undefined) throw new Error("a directory is needed");
  options.exclude = exclude;
  return {
    directory,
    out: out ?? `${basename(resolve(directory))}.project.json`,
    allowMissing,
    options,
  };
}

async function main() {
  let args: CliArgs | "help";
  try {
    args = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage);
    process.exit(1);
  }
  if (args === "help") {
    console.log(usage);
    return;
  }
  if (!isDirectory(args.directory)) {
    console.error(`${args.directory} is not a directory`);
    process.exit(1);
  }
  const { file, report } = await importRepository(args.directory, args.options);
  await Bun.write(args.out, JSON.stringify(file, null, 2) + "\n");
  console.error(describeRepositoryImport(report));
  const approved = file.documents.filter((document) => document.approved);
  console.error(
    `Wrote ${relative(process.cwd(), args.out) || args.out}: ${file.documents.length} documents, ${approved.length} approved`,
  );
  if (report.missing.length) {
    console.error(
      `Missing: ${report.missing.join(", ")}. Draft them and run again with --drafts <dir>, or import without them with --allow-missing.`,
    );
    if (!args.allowMissing) process.exit(2);
  }
}

if (import.meta.main) await main();
