/**
 * What specialists report back, curated for the person's chat. Every update a
 * specialist mails, on its own thread or on the person's, folds into one
 * collapsed tool call placed where it happened, named by what it was about:
 * consecutive updates from one specialist share a call that reads
 * "Constraints" or "Build · 4 updates" over the latest summary, a repeated
 * update shows once, and a long run of rows folds under one line. Only a specialist still at work
 * shows live, in the activity strip. The task a specialist was handed is the coordinator's hand-off
 * call, so it never becomes an update.
 */
import { COORDINATOR_NOTE_LEAD } from "@corbits-builder/schemas/native-specialist";
import { wording } from "../../config.ts";
import type { ConversationThread } from "../../api/conversation.ts";
import { roleLabel, roleOf } from "./roles.ts";
import { visibleChatText } from "./visible-chat.ts";
import { type } from "arktype";
import { readJson } from "../../json.ts";
import type { UpdatesRow } from "./specialist-updates.view.tsx";

export type SpecialistUpdate = {
  readonly sender: string;
  readonly text: string;
  readonly at: number;
};

export type UpdateGroup = {
  readonly key: string;
  readonly sender: string;
  readonly updates: readonly SpecialistUpdate[];
};

const MailEnvelope = type("object");
const MailResult = type({ result: { summary: "string" } });

// Mail between agents is a JSON envelope; its prose field is what a person can read.
// A task envelope is the hand-off, already shown as that call in the coordinator's turn.
function mailProse(text: string): string {
  const envelope = readJson(text, MailEnvelope);
  if (envelope === null) return text;
  const result = MailResult(envelope);
  return result instanceof type.errors ? "" : result.result.summary;
}

// A specialist's words without Builder's note to the coordinator after them.
function ownWords(text: string): string {
  const note = text.indexOf(COORDINATOR_NOTE_LEAD);
  return note === -1 ? text : text.slice(0, note);
}

/** One specialist turn as an update, or null when nothing in it is for a person. */
export function specialistUpdate(
  sender: string,
  text: string,
  at: number,
): SpecialistUpdate | null {
  const shown = visibleChatText(ownWords(mailProse(text)));
  return shown.length === 0 ? null : { sender, text: shown, at };
}

/** The specialists' own mail on their threads; the coordinator's side is its hand-off. */
export function threadUpdates(
  threads: readonly ConversationThread[],
): SpecialistUpdate[] {
  return threads.flatMap((thread) =>
    thread.turns.flatMap((turn) => {
      if (turn.role !== "participant") return [];
      const update = specialistUpdate(turn.sender, turn.text, turn.at);
      return update === null ? [] : [update];
    }),
  );
}

/** Updates in time order, a specialist's repeated text kept only where it first appeared. */
export function distinctUpdates(
  updates: readonly SpecialistUpdate[],
): SpecialistUpdate[] {
  const seen = new Set<string>();
  return [...updates]
    .sort((left, right) => left.at - right.at)
    .filter((update) => {
      const identity = `${update.sender}\n${update.text}`;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
}

/** Consecutive updates from one specialist as one group. */
export function groupUpdates(
  updates: readonly SpecialistUpdate[],
): UpdateGroup[] {
  const groups: { key: string; sender: string; updates: SpecialistUpdate[] }[] =
    [];
  for (const update of updates) {
    const last = groups.at(-1);
    if (last !== undefined && last.sender === update.sender)
      last.updates.push(update);
    else
      groups.push({
        key: `updates:${update.sender}:${String(update.at)}`,
        sender: update.sender,
        updates: [update],
      });
  }
  return groups;
}

/** A report's first line, without its markdown. */
export function summaryLine(text: string): string {
  const line =
    text.split("\n").find((candidate) => candidate.trim() !== "") ?? "";
  return line
    .replace(/[#*_`>]/g, "")
    .replace(/^\s*(?:[-+]|\d+[.)])\s+/, "")
    .trim();
}

/** What a lone specialist's reports were about: a role that writes code only ever builds the app. */
export function updateSubject(sender: string): string | undefined {
  return roleOf(sender)?.writesCode ? wording.buildSubject : undefined;
}

/** A group as the row the thread draws for it, named by its subject, else by who reported. */
export function updatesRow(
  group: UpdateGroup,
  subject: string | undefined,
): UpdatesRow {
  const latest = group.updates.at(-1);
  return {
    key: group.key,
    title: wording.updates(
      subject ?? roleLabel(group.sender),
      group.updates.length,
    ),
    summary: latest === undefined ? null : summaryLine(latest.text),
    reports: group.updates,
  };
}
