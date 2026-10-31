/**
 * What the project conversation shows.
 *
 * The durable turn and the live frame keep every id, hash, and tool payload
 * for logs and devtools. The transcript body does not: a person should see
 * the question, the decision, the document, or a plain failure — not the
 * coordinator's bookkeeping.
 */
import { wording } from "../../config.ts";
import type { ConversationPart } from "@corbits/react-ui";

const SNAKE = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+){1,}\b/;
const RUN = /\brun_[A-Za-z0-9_-]+\b/;
const PROJECT = /\bsb-[a-z0-9]{6,}\b/i;
const ARTIFACT = /\bartifact-[a-z0-9][a-z0-9_-]*/i;
const HASH = /\b[0-9a-f]{64}\b/i;
const ASSIGNMENT = /\bassignmentReady\b(?:\s*[:=]\s*(?:true|false))?/;
const REVISION =
  /\brevisions?\b\s*[#:=]?\s*(?:"[^"]+"|'[^']+'|\d+|\d{4}-\d{2}-\d{2}[Tt][\d:.zZ+-]+)/;
const LABELED =
  /\b(?:eventCount|toolCallId|partialArguments|deliverableId|artifactId|projectId|correlationId|runId)\b(?:\s*[:=]\s*(?:"[^"]+"|'[^']+'|\S+))?/;
// "blocker" is also a plain word a person reads; only its labeled form is bookkeeping.
const BLOCKER = /\bblockers?\s*[:=]\s*(?:"[^"]+"|'[^']+'|\S+)/;

const INTERNAL = [
  SNAKE,
  RUN,
  PROJECT,
  ARTIFACT,
  HASH,
  ASSIGNMENT,
  REVISION,
  LABELED,
  BLOCKER,
];

const FUNCTION_WORDS = new Set([
  "a",
  "an",
  "the",
  "to",
  "of",
  "for",
  "and",
  "or",
  "i",
  "is",
  "it",
  "that",
  "this",
  "on",
  "in",
  "with",
  "from",
  "be",
  "was",
  "were",
  "am",
  "are",
  "as",
  "at",
  "by",
  "if",
  "so",
  "we",
  "you",
  "your",
  "our",
  "not",
  "but",
  "its",
  "can",
  "will",
]);

const OPERATOR_WORDS = new Set([
  "specialist",
  "run",
  "revision",
  "revisions",
  "status",
  "tool",
  "event",
  "assignment",
  "blocker",
  "artifact",
  "project",
  "hash",
  "sha",
  "workflow",
  "native",
  "deployed",
  "pending",
  "payload",
  "message",
]);

function hasInternal(text: string): boolean {
  return INTERNAL.some((pattern) => pattern.test(text));
}

// A label like "kind problem_brief" or "artifact artifact-1" goes whole, not just its value.
const LABEL_BEFORE_INTERNAL = new RegExp(
  `\\b(?:kind|artifact|version)\\b\\s*[:=]?\\s*(?:${INTERNAL.map((pattern) => pattern.source).join("|")})(?:\\s+v\\d+)?`,
  "gi",
);

function stripTokens(text: string): string {
  let next = text.replace(LABEL_BEFORE_INTERNAL, " ");
  for (const pattern of INTERNAL)
    next = next.replace(new RegExp(pattern.source, "gi"), " ");
  return next;
}

function jsonEnd(text: string, start: number): number {
  const close = text[start] === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (inString) {
      if (escape) escape = false;
      else if (char === "\\") escape = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") depth += 1;
    else if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) return char === close ? index + 1 : -1;
    }
  }
  return -1;
}

/** Drop JSON values. A status object is not a sentence. */
function stripJson(text: string): string {
  let out = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (char !== "{" && char !== "[") {
      out += char;
      continue;
    }
    const end = jsonEnd(text, index);
    if (end === -1) {
      out += char;
      continue;
    }
    const slice = text.slice(index, end);
    try {
      const value = JSON.parse(slice) as unknown;
      if (value !== null && typeof value === "object") {
        index = end - 1;
        continue;
      }
    } catch {
      // Not a payload. Keep the brace and keep scanning.
    }
    out += char;
  }
  return out;
}

function stripInternalFences(text: string): string {
  return text.replace(/```[^\n]*\n?[\s\S]*?```/g, (block) =>
    hasInternal(block) ? "" : block,
  );
}

function contentWords(text: string): string[] {
  return (text.match(/[A-Za-z][A-Za-z']*/g) ?? []).filter(
    (word) => !FUNCTION_WORDS.has(word.toLowerCase()),
  );
}

function tidy(text: string): string {
  return text
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,.;:]){2,}/g, "$1")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[,:;.\-–—\s]+/, "")
    .replace(/[,:;]\s*$/, "")
    .trim();
}

function scrubSentence(sentence: string): string | null {
  const trimmed = sentence.trim();
  if (trimmed.length === 0) return null;
  if (!hasInternal(trimmed)) return trimmed;
  const withoutAsides = trimmed.replace(/\([^()]*\)/g, (group) =>
    hasInternal(group) ? "" : group,
  );
  const cleaned = tidy(stripTokens(withoutAsides));
  if (cleaned.length === 0 || hasInternal(cleaned)) return null;
  const words = contentWords(cleaned);
  if (words.length < 2) return null;
  if (words.every((word) => OPERATOR_WORDS.has(word.toLowerCase())))
    return null;
  return /[.!?]$/.test(cleaned) ? cleaned : cleaned;
}

function plainFallback(text: string): string {
  if (
    /\b(?:blocked|blocker|blockers|failed|failure|error)\b/i.test(text) ||
    /"isError"\s*:\s*true/.test(text)
  )
    return wording.message.stepFailed;
  if (/\bassignmentReady\b[^.\n]{0,80}\btrue\b/.test(text))
    return "The specialist can take the next step.";
  if (/\bassignmentReady\b[^.\n]{0,80}\bfalse\b/.test(text))
    return "The specialist is not ready yet.";
  return "";
}

/** A parenthetical naming bookkeeping goes whole, before its code spans are cut and leave "(, version 2)". */
function stripInternalAsides(text: string): string {
  return text.replace(/[ \t]*\([^()\n]*\)/g, (group) =>
    hasInternal(group) ? "" : group,
  );
}

/** An inline code span naming bookkeeping goes whole, so no empty chip is left behind. */
function stripInternalCode(text: string): string {
  return text.replace(/`[^`\n]+`/g, (span) => (hasInternal(span) ? "" : span));
}

// Markdown structure a line opens with: kept as written so lists, quotes, and
// headings still render as structure rather than run together as prose.
const LINE_MARKER = /^(\s*(?:[-*+]|\d+[.)])\s+|\s*#{1,6}\s+|\s*>\s?)/;

function scrubLine(line: string): string | null {
  const marker = LINE_MARKER.exec(line)?.[0] ?? "";
  const sentences = line
    .slice(marker.length)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => scrubSentence(sentence))
    .filter((sentence): sentence is string => sentence !== null);
  return sentences.length > 0 ? `${marker}${sentences.join(" ")}` : null;
}

/**
 * Assistant text for the transcript. Person text is not passed here: their
 * own words stay as they wrote them.
 */
export function visibleChatText(text: string): string {
  const source = stripInternalCode(
    stripInternalAsides(stripJson(stripInternalFences(text))),
  );
  const kept: string[] = [];
  for (const block of source.split(/(```[^\n]*\n[\s\S]*?```)/)) {
    if (block.startsWith("```")) {
      kept.push(block.trim());
      continue;
    }
    for (const paragraph of block.split(/\n{2,}/)) {
      const lines = paragraph
        .split("\n")
        .map((line) => scrubLine(line))
        .filter((line): line is string => line !== null);
      if (lines.length > 0) kept.push(lines.join("\n"));
    }
  }
  const prose = kept
    .join("\n\n")
    .replace(/(\S)[ \t]{2,}/g, "$1 ")
    .trim();
  return prose.length > 0 ? prose : plainFallback(text);
}

const roleLabels: Readonly<Record<string, string>> = wording.activity.role;

/** A workflow run on a mail thread, named as the activity strip names its role. */
export function participantLabel(sender: string): string {
  return roleLabels[sender] ?? sender.charAt(0).toUpperCase() + sender.slice(1);
}

export function turnLabel(turn: {
  readonly role: "person" | "assistant" | "participant";
  readonly sender?: string;
}): string {
  if (turn.role === "person") return wording.speaker.you;
  if (turn.role === "assistant") return wording.speaker.coordinator;
  return participantLabel(turn.sender ?? wording.speaker.specialist);
}

/** Parts the transcript may render. Tool and reasoning frames stay on the turn for devtools; their text is not copied into the body. */
export function visibleTurnParts(turn: {
  readonly role: "person" | "assistant" | "participant";
  readonly text: string;
  readonly parts?: readonly ConversationPart[] | undefined;
}): readonly ConversationPart[] {
  const parts =
    turn.parts ??
    (turn.text.length === 0
      ? []
      : [{ kind: "text" as const, text: turn.text }]);
  if (turn.role === "person") return parts;
  const visible: ConversationPart[] = [];
  for (const part of parts) {
    if (part.kind !== "text") {
      visible.push(part);
      continue;
    }
    const text = visibleChatText(part.text);
    if (text.length > 0) visible.push({ kind: "text", text });
  }
  return visible;
}
