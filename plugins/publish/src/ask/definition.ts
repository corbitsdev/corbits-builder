import { defineTask } from "@corbits-builder/plugin";
import { type } from "arktype";
import { PUBLISH_ASKED } from "../go-ahead.ts";
import { publishState } from "../published/state.ts";

// What the coordinator is told the person asked for, in the words of where publishing stands.
export const notes = {
  publish:
    "They asked to publish the app. Publish it as the ready-made publish plan's guidance says.",
  changes:
    "They asked to publish the changes they saved since it was last published. Publish them as the ready-made publish plan's guidance says.",
  continue:
    "They asked to carry on publishing the app from where it stopped. Carry on as the ready-made publish plan's guidance says.",
  takeDown:
    "They asked to take the app down. Open publish take-down with the plan whose target publish.release or publish.holding names, then go on as that plan's guidance says.",
};

const UNDER_WAY = new Set(["publishing", "takingDown", "needsYou"]);

// A press of Publish, Publish changes, Carry on publishing, Try again or Take it down. The hub's
// clock dates it, so the tab shows the work under way until the coordinator takes it up.
export default defineTask({
  says: "The person asked from the Publish tab.",
  input: type({ "+": "reject", for: "'publish' | 'takeDown'" }),
  describe: {
    fields: {
      for: { about: "What the person asked for: publish, or takeDown." },
    },
  },
  writes: [PUBLISH_ASKED],
  run: (project, input) => {
    const shown = publishState(project)?.state.state;
    // A second press while the work is under way or waits on the person would start it twice.
    if (shown !== undefined && UNDER_WAY.has(shown)) return { saves: [] };
    const note =
      input.for === "takeDown"
        ? notes.takeDown
        : shown === "changes"
          ? notes.changes
          : shown === "stalled"
            ? notes.continue
            : notes.publish;
    return {
      saves: [
        {
          name: PUBLISH_ASKED,
          value: { kind: input.for, at: new Date(project.now).toISOString() },
        },
      ],
      note,
    };
  },
});
