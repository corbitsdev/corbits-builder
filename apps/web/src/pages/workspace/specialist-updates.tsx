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
import { wording } from "../../config.ts";
import {
  ConversationItem,
  Tool,
  ToolHeader,
  ToolOutput,
} from "@corbits/react-ui";
import { Markdown } from "../../markdown.jsx";
import type { ConversationThread } from "../../api/conversation.ts";
import { participantLabel, visibleChatText } from "./visible-chat.ts";

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

// Mail between agents is a JSON envelope; its prose field is what a person can read.
// A task envelope is the hand-off, already shown as that call in the coordinator's turn.
function mailProse(text: string): string {
  try {
    const value = JSON.parse(text) as { result?: { summary?: unknown } };
    if (typeof value.result?.summary === "string") return value.result.summary;
  } catch {
    return text;
  }
  return "";
}

/** One specialist turn as an update, or null when nothing in it is for a person. */
export function specialistUpdate(
  sender: string,
  text: string,
  at: number,
): SpecialistUpdate | null {
  const shown = visibleChatText(mailProse(text));
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

/** What a lone specialist's reports were about: the coder only ever builds the whole app. */
export function updateSubject(sender: string): string | undefined {
  return sender === "coder" ? wording.buildSubject : undefined;
}

function UpdateRow({
  group,
  subject,
}: {
  group: UpdateGroup;
  subject: string | undefined;
}) {
  const latest = group.updates.at(-1);
  return (
    <Tool
      part={{
        kind: "tool-trace",
        toolCallId: group.key,
        name: "",
        status: "output-available",
        output: group.updates.map((update) => update.text),
      }}
    >
      <ToolHeader
        className="room-mail-row"
        label={
          <>
            <span className="room-mail-names">
              {wording.updates(
                subject ?? participantLabel(group.sender),
                group.updates.length,
              )}
            </span>
            {latest === undefined ? null : (
              <span className="room-mail-summary">
                {summaryLine(latest.text)}
              </span>
            )}
          </>
        }
        statusLabels={{ "output-available": "" }}
      />
      <ToolOutput
        title={wording.reported}
        render={() =>
          group.updates.map((update) => (
            <div
              key={`${String(update.at)}:${update.text}`}
              className="room-mail-turn"
            >
              <Markdown source={update.text} />
            </div>
          ))
        }
      />
    </Tool>
  );
}

/** A finished specialist's reports as one tool call, where they happened in the thread. */
export function SpecialistUpdates({
  group,
  subject,
}: {
  group: UpdateGroup;
  subject?: string;
}) {
  return (
    <ConversationItem itemId={group.key}>
      <UpdateRow group={group} subject={subject} />
    </ConversationItem>
  );
}

/** A long run of report rows folded under one line, each row still there to open. */
export function FoldedUpdates({
  groups,
  subjects,
}: {
  groups: readonly UpdateGroup[];
  subjects: ReadonlyMap<string, string>;
}) {
  const count = groups.reduce((sum, group) => sum + group.updates.length, 0);
  return (
    <ConversationItem itemId={`folded:${groups[0]?.key ?? ""}`}>
      <details className="room-mail-fold">
        <summary>{wording.updatesFolded(count)}</summary>
        {groups.map((group) => (
          <UpdateRow
            key={group.key}
            group={group}
            subject={subjects.get(group.key)}
          />
        ))}
      </details>
    </ConversationItem>
  );
}
