/** Whether the document tips show in the pane bar, chosen in Settings and kept in this browser. */
import {
  useStoredPreference,
  writeStoredPreference,
} from "./stored-preference.ts";

const TIPS_KEY = "builder-document-tips";

export type OnOff = "on" | "off";

const parseOnOff = (raw: string): OnOff | null =>
  raw === "on" || raw === "off" ? raw : null;

export function useDocumentTips(): OnOff {
  return useStoredPreference(TIPS_KEY, parseOnOff, "on");
}

export function writeDocumentTips(choice: OnOff): void {
  writeStoredPreference(TIPS_KEY, choice);
}
