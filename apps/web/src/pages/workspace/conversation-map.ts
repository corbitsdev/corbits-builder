/**
 * The conversation map's entries for what the agents produced: a filed document, a design or the
 * code, a question or approval put to the person, and work that did not finish. Each is anchored to
 * the item that shows it, a specialist's own row for its work, and named in the words its row uses. The coordinator's replies, its steps
 * and work still under way have none.
 */
import type { ConversationMapTurn } from "@corbits/react-ui";
import type { ParkedQuestion } from "@corbits-builder/schemas/conversation";
import { isDocumentKind } from "@corbits-builder/schemas/artifact";
import { wording } from "../../config.ts";
import { approvalQuestion } from "./collaboration.ts";
import type { DocumentApproval } from "./transcript.tsx";
import type { WorkUnitStanding } from "./work-unit-step.view.tsx";
import { workPhrase, type WorkUnit } from "./work-unit.ts";

const text = wording.conversation;

/** A piece of work's entry once it filed, finished, failed or was stopped. */
export function workEntry(
  id: string,
  unit: WorkUnit,
  standing: WorkUnitStanding,
): ConversationMapTurn[] {
  const { status } = standing;
  const phrase = workPhrase(unit.dispatch, status);
  const entry = (label: string) => [{ id, label, preview: standing.label }];
  if (status.state === "ready" && isDocumentKind(status.kind))
    return entry(
      text.mapDocument(
        wording.documentTab[status.kind] ?? status.title,
        status.version,
      ),
    );
  if (status.state === "ready" || status.state === "finished")
    return entry(phrase);
  if (status.state === "failed")
    return entry(text.mapMarked(phrase, wording.dispatch.status.error));
  if (status.state === "stopped")
    return entry(text.mapMarked(phrase, wording.dispatch.stopped));
  return [];
}

/** A question card's entry, by its first question's short header, marked once answered. */
export function questionEntry(
  id: string,
  question: ParkedQuestion,
): ConversationMapTurn[] {
  const { asked, answer } = question;
  const label =
    "plugin" in asked
      ? wording.questions.title(1)
      : (asked.questions[0]?.header ?? wording.questions.title(1));
  return [{ id, label: answered(label, answer !== undefined) }];
}

/** An approval card's entry, by the question it asks, marked once decided. */
export function approvalEntry(
  id: string,
  approval: DocumentApproval,
): ConversationMapTurn[] {
  const label =
    approval.packages === undefined
      ? approvalQuestion(approval.toolName, approval.subject)
      : wording.approval.packages(approval.packages.join(", "));
  return [{ id, label: answered(label, approval.outcome !== undefined) }];
}

const answered = (label: string, settled: boolean) =>
  settled ? text.mapMarked(label, wording.questions.answered) : label;

/** One entry per item: the rail keys its ticks by item id. */
export function distinctEntries(
  entries: readonly ConversationMapTurn[],
): ConversationMapTurn[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}
