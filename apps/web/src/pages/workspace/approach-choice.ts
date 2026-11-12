/**
 * The person's pick among a version's filed approaches, read from the conversation so it
 * survives a reload: the latest person turn that is the choice message for one of them.
 */
import type { ApproachesMeta } from "@corbits-builder/schemas/approaches";
import { wording } from "../../config.ts";

export type ApproachChoice = {
  /** The chosen approach's id for the version filed at filedAt, if the person picked one since. */
  chosen: (meta: ApproachesMeta, filedAt: string) => string | undefined;
  /** Declines any open ask, then sends the message; resolves to a fault, or null once sent. Absent where choosing is closed. */
  choose?: (message: string) => Promise<string | null>;
};

export function chosenApproach(
  meta: ApproachesMeta,
  turns: readonly { role: string; text: string; at: number }[],
  since: number,
): string | undefined {
  const byMessage = new Map(
    meta.approaches.map((approach) => [
      wording.approaches.message(approach.name),
      approach.id,
    ]),
  );
  let chosen: { id: string; at: number } | undefined;
  for (const turn of turns) {
    if (turn.role !== "person" || turn.at <= since) continue;
    const id = byMessage.get(turn.text.trim());
    if (id !== undefined && (chosen === undefined || turn.at >= chosen.at))
      chosen = { id, at: turn.at };
  }
  return chosen?.id;
}
