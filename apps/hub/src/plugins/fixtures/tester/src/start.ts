import { type } from "arktype";
import { defineStarter } from "@corbits-builder/plugin";

// The run keeps what it was asked as its record, and saves it as the project's notes.
export default defineStarter(
  type({ "+": "reject", workflow: "'tester-probe'" }),
  type({ instruction: "string" }),
  async ({ workflow }, { instruction }, project) => {
    const { runId } = await project.startAlone({
      workflow,
      correlation: workflow,
      assignment: () => instruction,
      busy: () => new Error("Another probe is starting."),
      keep: () => ({
        record: { asked: instruction },
        values: { "tester.notes": instruction },
      }),
    });
    return { runs: [{ runId }], notStarted: [] };
  },
);
