/**
 * Who is at work right now, as the hub reads it from native state: the runs
 * Interchange reports mid-turn and the tool calls their own inference events
 * carried. A phrase is a fixed reading of the latest call, never a guess at
 * progress.
 */
import { useQuery } from "@tanstack/react-query";
import type { AgentActivity } from "@corbits-builder/client";
import {
  readProjectActivity,
  readProjectRunStates,
} from "../../api/activity.ts";
import { keys } from "../../queries/keys.ts";
import { wording } from "../../config.ts";

const POLL_MS = 10_000;
const BUSY_POLL_MS = 3_000;
const RUN_STATE_POLL_MS = 5_000;
const text = wording.activity;
// The calls that hold until the person answers.
const ASKS = new Set(["instruct_coder", "request_approval", "design_app"]);
const CHECK_SCRIPT = /\bcheck-app\b/;

// A person sees what the file is, never where it lives: no folders, no internal ids.
function fileLabel(path: string): string {
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

/** A tool call in plain words, from the strip's own phrases: "Reading the problem brief". */
export function toolPhrase(name: string, subject: string | undefined): string {
  const describe = text.tool[name];
  const named = subjectFor(name, subject);
  const phrase = describe ? describe(named) : text.otherTool(name);
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

// One verb per file, so the line changes when the file does and not on every poll.
function verbFor(verbs: readonly string[], subject: string): string {
  let hash = 0;
  for (const char of subject) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return verbs[hash % verbs.length] ?? verbs[0] ?? "";
}

// The hub sees a run's events only from its own start; a run open this long with none is idle.
const IDLE_AFTER_MS = 120_000;

export function activityPhrase(agent: AgentActivity): {
  phrase: string;
  asking: boolean;
} {
  const latest = agent.tools.at(-1);
  if (latest === undefined) {
    if (agent.role === "coordinator")
      return { phrase: text.thinking, asking: false };
    const idle = Date.now() - Date.parse(agent.since) > IDLE_AFTER_MS;
    return { phrase: idle ? text.thinking : text.starting, asking: false };
  }
  const asking = ASKS.has(latest.name);
  if (asking && !latest.running)
    return { phrase: text.thinking, asking: false };
  const describe = text.tool[latest.name];
  const subject = subjectFor(latest.name, latest.subject);
  const verbs = text.fileVerbs[latest.name];
  if (verbs && subject)
    return { phrase: `${verbFor(verbs, subject)} ${subject}`, asking: false };
  return {
    phrase: describe ? describe(subject) : text.otherTool(latest.name),
    asking: asking && latest.running,
  };
}

export function useProjectActivity(projectId: string) {
  return useQuery({
    queryKey: keys.projectActivity.of(projectId),
    queryFn: ({ signal }) => readProjectActivity(projectId, signal),
    // While anyone is mid-turn, a hand-off and each step read sooner.
    refetchInterval: (query) =>
      (query.state.data?.agents.length ?? 0) > 0 ? BUSY_POLL_MS : POLL_MS,
    refetchOnWindowFocus: false,
  });
}

/**
 * Each live run's state by its latest committed event, polled while any run is live. A run that
 * parks on an approval raises no room event, so this is how the page learns the person's turn came.
 */
export function useProjectRunStates(projectId: string) {
  return useQuery({
    queryKey: keys.projectRunStates.of(projectId),
    queryFn: ({ signal }) => readProjectRunStates(projectId, signal),
    refetchInterval: (query) =>
      (query.state.data?.runs.length ?? 0) > 0 ? RUN_STATE_POLL_MS : POLL_MS,
    refetchOnWindowFocus: false,
  });
}

/** The runs held on an approval, as one string a React effect can depend on. */
export function heldOnApproval(
  states: { runs: readonly { runId: string; state: string }[] } | undefined,
): string {
  return (states?.runs ?? [])
    .filter((run) => run.state === "approval")
    .map((run) => run.runId)
    .sort()
    .join(",");
}

/** The roles with a run mid-turn right now, from the hub's native activity read. */
export function useRolesAtWork(projectId: string): ReadonlySet<string> {
  const agents = useProjectActivity(projectId).data?.agents ?? [];
  return new Set(agents.map((agent) => agent.role));
}
