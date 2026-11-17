import { join } from "node:path";
import { HUB_NOTE_LEAD } from "@corbits-builder/schemas/conversation";

// A guard against a runaway design, not a target size. When real mockups need more room, raising
// it is a change to this constant alone.
export const MAX_DESIGN_BYTES = 4 * 1024 * 1024;

export const designSizeHint = (bytes: number, largest: string) =>
  `The design is ${bytes} bytes; the limit is ${MAX_DESIGN_BYTES} bytes (${MAX_DESIGN_BYTES / (1024 * 1024)} MiB). Largest files: ${largest}.`;
export const designTrimNote =
  "Trim repeated markup or unused assets in those files, then run check_design again.";

export const designChangedDuringCheck =
  "check failed: the design changed during checking. Run check_design again to validate and save.";
export const designCheckRunning =
  "Not started: a design check is already running. Wait for its result before checking again.";

export const DESIGNS = join(".builder", "designs");
// check-app also reads the design document beside the mockup.
export const DESIGN_DOC = join(".builder", "DESIGN.md");

export const checkDesignDefinition = {
  name: "check_design",
  description: `Runs check-app on the design as it is now: it serves ${DESIGNS} in a headless browser, opens its screens at desktop and phone widths, checks that ${DESIGN_DOC} is filled in, and that the look is moved off the kit's starting point. Call this once the screens and ${DESIGN_DOC} are written; when it reads "check passed", it also files the .builder folder as your design concept's option.`,
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
};

// The hub's note to the coordinator once the person chose a design option in the conversation.
export const designChosenNote = (concept: string, version: number) =>
  `${HUB_NOTE_LEAD}Design chosen: ${concept}.\n\nThe person chose the ${concept} design concept. It is filed as the design at version ${String(version)}, approved by them.`;
