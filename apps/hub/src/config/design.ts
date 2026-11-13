import { HUB_NOTE_LEAD } from "./resume.ts";

// The hub's note to the coordinator once the person chose a design option in the conversation.
export const designChosenNote = (concept: string, version: number) =>
  `${HUB_NOTE_LEAD}Design chosen: ${concept}.\n\nThe person chose the ${concept} design concept. It is filed as the design at version ${String(version)}, approved by them. The build plan is written from it next.`;
