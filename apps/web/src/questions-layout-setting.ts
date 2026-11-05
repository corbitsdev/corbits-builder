/** Whether the coordinator's questions come one at a time or all at once, chosen in Settings and kept in this browser. */
import {
  useStoredPreference,
  writeStoredPreference,
} from "./stored-preference.ts";

const LAYOUT_KEY = "builder-questions-layout";

export type QuestionsLayout = "steps" | "all";

const parseLayout = (raw: string): QuestionsLayout | null =>
  raw === "steps" || raw === "all" ? raw : null;

export function useQuestionsLayout(): QuestionsLayout {
  return useStoredPreference(LAYOUT_KEY, parseLayout, "steps");
}

export function writeQuestionsLayout(layout: QuestionsLayout): void {
  writeStoredPreference(LAYOUT_KEY, layout);
}
