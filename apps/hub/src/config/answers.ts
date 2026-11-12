import { wrongCount, wrongText, type Refusal } from "@corbits-builder/plugin";

// The answers route's refusal, written for the person: the screen was shown and its question is
// still open; only the answer they sent does not fit it.
export const answerRefusedText = (screen: string, refusal: Refusal) =>
  [
    `Your answer to ${screen} was not saved because it does not fit what the screen takes. ${wrongCount(refusal)}`,
    "",
    ...wrongText(refusal),
    "",
    "Nothing was saved and the question is still open, so it can be answered again with these corrected.",
  ].join("\n");
