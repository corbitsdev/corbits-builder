/**
 * The collaboration surface: a document the person can open, the question
 * asked before a recorded approval, and that approval as the part its card
 * draws. What the person reads is titles only — never ids.
 */
import type { PartTool, ToolApprovalStatus } from "@corbits/react-ui";
import { wording } from "../../config.ts";

export type NamedDocument = {
  readonly id: string;
  readonly title: string;
};

export type ProseSegment =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "document"; readonly id: string; readonly title: string };

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Split prose so each known document title can be its own control. */
export function proseSegments(
  text: string,
  documents: readonly NamedDocument[],
): readonly ProseSegment[] {
  const named = documents
    .filter((document) => document.title.trim().length >= 3)
    .sort((left, right) => right.title.length - left.title.length);
  if (named.length === 0 || text.length === 0) return [{ kind: "text", text }];
  const segments: ProseSegment[] = [];
  let index = 0;
  while (index < text.length) {
    let found:
      | { start: number; end: number; id: string; title: string }
      | undefined;
    const rest = text.slice(index);
    for (const document of named) {
      const match = new RegExp(
        `\\b${escapeRegExp(document.title)}\\b`,
        "i",
      ).exec(rest);
      if (match === null || match.index === undefined) continue;
      const start = index + match.index;
      const end = start + match[0].length;
      if (
        found === undefined ||
        start < found.start ||
        (start === found.start && end > found.end)
      ) {
        found = { start, end, id: document.id, title: match[0] };
      }
    }
    if (found === undefined) {
      segments.push({ kind: "text", text: text.slice(index) });
      break;
    }
    if (found.start > index)
      segments.push({ kind: "text", text: text.slice(index, found.start) });
    segments.push({ kind: "document", id: found.id, title: found.title });
    index = found.end;
  }
  return segments;
}

/** A document's name as the approval card says it: "requirements", "build plan". */
export function shortDocumentName(kind: string, title: string): string {
  return wording.approval.shortName[kind] ?? documentPhrase(title);
}

/** The card's question, naming the tool ("browser.browser_navigate" as "browser navigate"). */
export function approvalQuestion(
  toolName: string | undefined,
  subject?: string,
): string {
  if (toolName === undefined) return wording.approval.unnamed;
  const tool = toolName
    .slice(toolName.lastIndexOf(".") + 1)
    .replaceAll("_", " ");
  return wording.approval.tool(tool, subject);
}

/** A document's title as it reads mid-sentence. */
export function documentPhrase(documentTitle: string): string {
  const name = documentTitle.trim();
  // A title-cased name ("Weather App Brief") is a proper name and keeps its case.
  const titleCased = /\s[A-Z]/.test(name);
  const lower = titleCased
    ? name
    : name.charAt(0).toLowerCase() + name.slice(1);
  return lower.startsWith("the ") ? lower.slice(4) : lower;
}

function partStatus(status: ToolApprovalStatus): PartTool["status"] {
  if (status === "pending") return "approval-requested";
  if (status === "approved") return "output-available";
  return "output-denied";
}

/**
 * A native approval as a tool part, pending or as its record settled it. Its
 * name stays empty: the card is titled by its question, never by the raw name
 * of the tool that asked.
 */
export function approvalToolPart(
  approvalId: string,
  outcome?: {
    readonly status: ToolApprovalStatus;
    readonly scope?: "once" | "always";
  },
): PartTool {
  const status = outcome?.status ?? "pending";
  const decided = status === "approved" || status === "rejected";
  return {
    kind: "tool-trace",
    toolCallId: approvalId,
    name: "",
    status: partStatus(status),
    approval: {
      id: approvalId,
      status,
      scope: decided ? (outcome?.scope ?? "once") : null,
      timeoutAt: null,
    },
  };
}
