/**
 * What an agent is doing, in words: a phrase is a fixed reading of its latest
 * tool call, never a guess at progress.
 */
import type { AgentActivity } from "@corbits-builder/client";
import { wording } from "../../config.ts";

const text = wording.activity;
const CHECK_SCRIPT = /\bcheck-(?:app|project)\b/;

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

/** A tool call in plain words, from the strip's own phrases: "Reading the problem brief". */
export function toolPhrase(name: string, subject: string | undefined): string {
  const describe = text.tool[name];
  const named = subjectFor(name, subject);
  const phrase = describe ? describe(named) : text.otherTool(name);
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

/** What a call returned, in plain words when its raw result means nothing to a person. */
export function toolResult(name: string, content: unknown): unknown {
  const plain = text.toolResult[name];
  if (plain !== undefined) return plain;
  if (typeof content !== "string") return content;
  try {
    return JSON.parse(content) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) return content;
    throw error;
  }
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
  const describe = text.tool[latest.name];
  const subject = subjectFor(latest.name, latest.subject);
  const verbs = text.fileVerbs[latest.name];
  if (verbs && subject) return `${verbFor(verbs, subject)} ${subject}`;
  return describe ? describe(subject) : text.otherTool(latest.name);
}
