/**
 * What an agent is doing, in words: a phrase is a fixed reading of its latest
 * tool call, never a guess at progress.
 */
import { type } from "arktype";
import type { AgentActivity } from "@corbits-builder/client";
import { wording } from "../../config.ts";
import { readJson } from "../../json.ts";

const text = wording.activity;
const detail = text.detail;
// A run of the project's own checks, however the command wraps it.
const CHECK_SCRIPT = /\bcheck-(?:stack|app|project)\b/;
const FILE_TOOLS = new Set(["read_file", "write_file", "edit_file"]);
const BROWSER_PREFIX = "browser.browser_";

/** A person sees what the file is, never where it lives: no folders, no internal ids. */
export function fileLabel(path: string): string {
  if (path.startsWith("tool-output:")) return text.files.earlierOutput;
  const name = path.split("/").filter(Boolean).at(-1) ?? path;
  if (/[0-9a-f]{12,}/.test(name)) return text.files.generic;
  const known = text.files.known[name];
  if (known) return known;
  const base = name
    .replace(/\.[^.]+$/, "")
    .replace(/[-_.]+/g, " ")
    .trim();
  return base.length > 0 ? base : name;
}

function shellSubject(command: string): string {
  return CHECK_SCRIPT.test(command) ? text.files.checkApp : text.files.command;
}

function subjectFor(
  name: string,
  subject: string | undefined,
): string | undefined {
  if (subject === undefined) return undefined;
  if (name === "run_shell") return shellSubject(subject);
  if (name.endsWith("_file")) return fileLabel(subject);
  if (name.endsWith("_artifact")) return subject.replaceAll("_", " ");
  return subject;
}

// The argument that names what a call touches, read in the hub's activity order.
const SUBJECT_KEYS = [
  "path",
  "file",
  "name",
  "command",
  "pattern",
  "query",
  "kind",
  "packages",
  // The coordinator's runs and plan calls are told apart by what they do.
  "operation",
];

/** What a call's arguments say it touches, as the hub's activity reads it. */
export function toolSubject(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const args = input as Record<string, unknown>;
  for (const key of SUBJECT_KEYS) {
    const value = args[key];
    const named = Array.isArray(value)
      ? value.filter((item) => typeof item === "string").join(", ")
      : value;
    if (typeof named === "string" && named.trim() !== "") return named.trim();
  }
  return undefined;
}

function stepPhrase(name: string) {
  return name.startsWith(BROWSER_PREFIX)
    ? text.browserStep[name.slice(BROWSER_PREFIX.length)]
    : text.step[name];
}

/** Whether the wording names this tool's steps, rather than falling back to its name. */
export const namesTool = (name: string) => stepPhrase(name) !== undefined;

const capitalized = (phrase: string) =>
  phrase.charAt(0).toUpperCase() + phrase.slice(1);

/** A step's row in plain words, as it works and once done: "Filing the build plan", then "Filed the build plan". */
export function toolPhrase(
  name: string,
  subject: string | undefined,
  done: boolean,
): string {
  return phrased(name, subjectFor(name, subject), done);
}

// The phrase for what a call touches, already in the words its row shows.
function phrased(name: string, named: string | undefined, done: boolean) {
  const phrase = stepPhrase(name);
  if (phrase === undefined) return capitalized(text.otherTool(name));
  return done ? phrase.done(named) : phrase.working(named);
}

/** The command a call runs, whatever the tool; undefined for a call that runs none. */
export function commandOf(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null || !("command" in input))
    return undefined;
  const { command } = input;
  return typeof command === "string" && command.trim() !== ""
    ? command
    : undefined;
}

/** The call's own word on what it does, when it carries one. */
function descriptionOf(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null || !("description" in input))
    return undefined;
  const { description } = input;
  return typeof description === "string" && description.trim() !== ""
    ? description.trim()
    : undefined;
}

/** A command as one line: its first, so a heredoc reads by how it starts. */
export function commandLine(command: string): string {
  return command.trim().split("\n", 1)[0]?.trimEnd() ?? "";
}

/**
 * A step as the person reads it: its row, and what opening it shows. A command opens onto itself
 * and what it printed, a check onto its list, anything else onto a line of plain words. With
 * neither a command nor anything that came of it, the row has nothing to open.
 */
export type Step = {
  readonly label: string;
  readonly command?: string | undefined;
  readonly output?: string | undefined;
  /** Code for a command's or a check's own output, words for anything said in plain words. */
  readonly face: "code" | "words";
};

const EXIT = /^exit code (\d+)\n?/;
// The end of a long output, where a failure is; the box scrolls through the rest.
const TAIL_LINES = 40;

/** What a command printed, its last lines, then its exit code when that is not zero. */
export function commandOutput(content: unknown): string | undefined {
  if (typeof content !== "string") return undefined;
  const exit = EXIT.exec(content);
  const printed = (exit === null ? content : content.slice(exit[0].length))
    .trimEnd()
    .split("\n")
    .slice(-TAIL_LINES)
    .join("\n");
  const said = [printed, exit === null ? "" : text.exitCode(Number(exit[1]))]
    .filter((part) => part.trim() !== "")
    .join("\n\n");
  return said === "" ? undefined : said;
}

/** The names report_values saves, as a person says them: "language and checks". */
function valueNames(names: readonly string[]): string | undefined {
  const said = names.map((name) => fieldWords(name).toLowerCase());
  if (said.length < 2) return said[0];
  return `${said.slice(0, -1).join(", ")} and ${said.at(-1) ?? ""}`;
}

/** A field's name in words: "stack.testCommand" reads "Test command". */
function fieldWords(name: string): string {
  const last = name.split(".").at(-1) ?? name;
  return capitalized(
    last
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replaceAll(/[_-]+/g, " ")
      .toLowerCase(),
  );
}

/** A plain value as a line's text: a list joined, anything nested left out. */
function valueText(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() === "" ? undefined : value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value) && value.every((item) => typeof item === "string"))
    return value.join(", ");
  return undefined;
}

// A result with no words of its own shows this many of its plain fields.
const SHOWN_FIELDS = 3;

/** Labelled lines for the plain fields of a record, never the record itself. */
function fieldLines(record: Record<string, unknown>, limit: number) {
  const lines = Object.entries(record).flatMap(([name, value]) => {
    const said = valueText(value);
    return said === undefined ? [] : [`${fieldWords(name)}: ${said}`];
  });
  return lines.length === 0 ? undefined : lines.slice(0, limit).join("\n");
}

const AnyRecord = type("Record<string, unknown>");
const Version = type({ version: "number" });
const ReadDocument = type({
  title: "string",
  version: "number",
  "part?": "number",
  "parts?": "number",
});
const DocumentList = type({ artifacts: "unknown[]" });
const RunningApp = type({ url: "string", running: "boolean", log: "string[]" });
const DeckIssues = type({
  "slideCount?": "number",
  "passed?": "boolean",
  "issues?": type({ path: "string", message: "string" }).array(),
});
const DoneChecks = type({
  results: type({
    check: "string",
    result: "'pass' | 'fail'",
    summary: "string",
    evidence: "string[]",
  }).array(),
}).or({ unrun: "string" });

const SHOWN_LOG_LINES = 10;
const FILED_DESIGN = /^Filed design_option: (.*)$/m;
const SHOWN_OF = /\.\.\. \(\d+ of (\d+) matches shown\)$/m;
// Short text with no structure of its own reads as a sentence.
const PROSE_CHARS = 280;
const PROSE_LINES = 3;

function lineCount(content: string): number {
  return content.trimEnd().split("\n").length;
}

/** How many matches a search found: its own total when it cut the list, else the lines it listed. */
function matchCount(content: string, counted: (line: string) => boolean) {
  const total = SHOWN_OF.exec(content)?.[1];
  if (total !== undefined) return Number(total);
  return content.split("\n").filter(counted).length;
}

/** What a file call came to, where that adds to its row: a read's length, an edit in several places. */
function fileDetail(name: string, content: string): string | undefined {
  if (name === "read_file") return detail.lines(lineCount(content));
  const replaced = /^replaced (\d+) occurrence/.exec(content)?.[1];
  if (name === "edit_file" && replaced !== undefined && Number(replaced) > 1)
    return detail.changedIn(Number(replaced));
  return undefined;
}

function appStatus(content: string): string | undefined {
  const app = readJson(content, RunningApp);
  if (app === null) return undefined;
  if (app.running) return detail.running(app.url);
  return [detail.notRunning, ...app.log.slice(-SHOWN_LOG_LINES)].join("\n");
}

function doneChecks(content: string): Step["output"] {
  const checks = readJson(content, DoneChecks);
  if (checks === null) return undefined;
  if ("unrun" in checks) return detail.checksNotRun(checks.unrun);
  return checks.results
    .map(({ check, result, summary, evidence }) =>
      result === "pass"
        ? `✓ ${check}`
        : [`✗ ${check}`, summary, ...evidence]
            .filter((line) => line.trim() !== "")
            .join("\n    "),
    )
    .join("\n");
}

function deckDetail(content: string): string | undefined {
  const deck = readJson(content, DeckIssues);
  if (deck === null) return content;
  const issues = (deck.issues ?? []).map(
    ({ path, message }) => `✗ ${path}: ${message}`,
  );
  if (deck.slideCount !== undefined)
    return [detail.slides(deck.slideCount), ...issues].join("\n");
  if (deck.passed === true) return detail.deckPassed;
  return issues.length === 0 ? undefined : issues.join("\n");
}

function readDetail(content: string): string | undefined {
  const document = readJson(content, ReadDocument);
  if (document !== null) {
    const said = detail.document(document.title, document.version);
    return document.part === undefined || document.parts === undefined
      ? said
      : `${said}, ${detail.part(document.part, document.parts)}`;
  }
  const list = readJson(content, DocumentList);
  return list === null ? undefined : detail.documents(list.artifacts.length);
}

function filedDetail(content: string): string | undefined {
  if (content.startsWith("unchanged:")) return detail.unchanged;
  const filed = readJson(content, Version);
  return filed === null ? undefined : detail.version(filed.version);
}

/** Any other result: its text when it is a short sentence, else a few of its plain fields. */
function otherDetail(content: string): string | undefined {
  const record = readJson(content, AnyRecord);
  if (record !== null) return fieldLines(record, SHOWN_FIELDS);
  const prose =
    content.length <= PROSE_CHARS &&
    lineCount(content) <= PROSE_LINES &&
    content.trim() !== "";
  return prose ? content.trim() : undefined;
}

/** What came of a call that ran no command, in the face it reads in. */
function resultDetail(
  name: string,
  content: string,
): Pick<Step, "output" | "face"> {
  switch (name) {
    case "check_design":
      return {
        face: "code",
        output: content.replace(FILED_DESIGN, (line, artifact: string) => {
          const filed = readJson(artifact, Version);
          return filed === null ? line : detail.filed(filed.version);
        }),
      };
    case "run_done_checks":
      return { face: "code", output: doneChecks(content) };
    case "check_deck":
      return { face: "code", output: deckDetail(content) };
    case "install_packages":
      return { face: "code", output: commandOutput(content) };
    case "write_deck":
      return { face: "words", output: deckDetail(content) };
    case "app_status":
      return { face: "words", output: appStatus(content) };
    case "read_artifact":
      return { face: "words", output: readDetail(content) };
    case "write_artifact":
    case "file_design_option":
    case "file_package":
      return { face: "words", output: filedDetail(content) };
    case "read_skill":
      return { face: "words", output: detail.lines(lineCount(content)) };
    case "search_files":
      return {
        face: "words",
        output: content.startsWith("no files matching")
          ? detail.nothingMatched
          : detail.matchingFiles(matchCount(content, (line) => line !== "")),
      };
    case "grep":
      return {
        face: "words",
        output: content.startsWith("no matches for")
          ? detail.nothingMatched
          : detail.matchingLines(
              matchCount(content, (line) => /:\d+:/.test(line)),
            ),
      };
    case "exec":
      return { face: "words", output: detail.rewritten };
    // The coordinator's own bookkeeping: what came of it shows in the rows and cards it led to.
    case "discover":
    case "execute":
    case "plan":
    case "runs":
    case "question":
      return { face: "words" };
    default:
      return { face: "words", output: otherDetail(content) };
  }
}

/**
 * A call as its step reads: a command by what it does, or as itself after "Ran"; a file call by
 * the path it touches; any other by its tool's phrase. `content` is what the call returned, once
 * it has.
 */
export function readStep(
  name: string,
  input: unknown,
  done: boolean,
  content: unknown,
): Step {
  const returned = typeof content === "string" ? content : undefined;
  const command = commandOf(input);
  if (name === "app_status")
    return {
      label: toolPhrase(name, command, done),
      command,
      ...(returned === undefined
        ? { face: "words" }
        : resultDetail(name, returned)),
    };
  if (command !== undefined) {
    const checks = done ? text.checks.done() : text.checks.working();
    return {
      label: CHECK_SCRIPT.test(command)
        ? checks
        : (descriptionOf(input) ?? commandLine(command)),
      command,
      output: commandOutput(content),
      face: "code",
    };
  }
  const subject = toolSubject(input);
  if (FILE_TOOLS.has(name))
    return {
      // A row names the file by its real path; only an earlier result has no path to show.
      label: phrased(
        name,
        subject?.startsWith("tool-output:") === true
          ? fileLabel(subject)
          : subject,
        done,
      ),
      output: returned === undefined ? undefined : fileDetail(name, returned),
      face: "words",
    };
  if (name === "report_values") {
    const values = AnyRecord(input);
    const record = values instanceof type.errors ? {} : values;
    return {
      label: phrased(name, valueNames(Object.keys(record)), done),
      output: fieldLines(record, Number.POSITIVE_INFINITY),
      face: "words",
    };
  }
  return {
    label: toolPhrase(name, subject, done),
    ...(returned === undefined
      ? { face: "words" }
      : resultDetail(name, returned)),
  };
}

// One verb per file, so the line changes when the file does and not on every poll.
function verbFor(verbs: readonly string[], subject: string): string {
  let hash = 0;
  for (const char of subject) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return verbs[hash % verbs.length] ?? verbs[0] ?? "";
}

// The hub sees a run's events only from its own start; a run open this long with none is idle.
const IDLE_AFTER_MS = 120_000;

export function activityPhrase(agent: AgentActivity): string {
  // A long command's own word on what it is doing beats a reading of the call that started it.
  if (agent.command !== undefined) return agent.command.line;
  const latest = agent.tools.at(-1);
  if (latest === undefined) {
    if (agent.role === "coordinator") return text.thinking;
    const idle = Date.now() - Date.parse(agent.since) > IDLE_AFTER_MS;
    return idle ? text.thinking : text.starting;
  }
  const subject = subjectFor(latest.name, latest.subject);
  const verbs = text.fileVerbs[latest.name];
  if (verbs && subject) return `${verbFor(verbs, subject)} ${subject}`;
  const phrase = toolPhrase(latest.name, latest.subject, false);
  return phrase.charAt(0).toLowerCase() + phrase.slice(1);
}
