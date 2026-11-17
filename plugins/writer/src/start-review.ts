import { type } from "arktype";
import { StartRefusal, defineStarter } from "@corbits-builder/plugin";
import { writerTask } from "./task.ts";

// The reviewer gets the document and, when the project has one, the problem brief.
export default defineStarter(
  type({ "+": "reject", workflow: "'reviewer'" }),
  type({ kind: "string", instruction: "string" }),
  async ({ workflow }, { kind, instruction }, project) => ({
    runs: [
      await project.deploy({
        workflow,
        correlation: "reviewer-" + kind,
        assignment: ({ versions, document }) => {
          if (!versions.has(kind))
            throw new StartRefusal(
              kind + "_not_filed: write and file the " + kind + " first",
            );
          return writerTask(
            {
              kind: "review",
              instruction,
              sources: [...versions]
                .filter(
                  ([filed]) => filed === "problem_brief" || filed === kind,
                )
                .map(([, version]) => version),
            },
            document,
          );
        },
      }),
    ],
    notStarted: [],
  }),
);
