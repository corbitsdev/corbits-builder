import { type } from "arktype";
import { defineStarter } from "@corbits-builder/plugin-host/catalog";
import {
  Refusal,
  type Project,
} from "@corbits-builder/plugin-host/coordinator";
import { writerTask } from "./task.ts";

// The reviewer checks the document against the problem brief when the project has one.
export default defineStarter(
  type({ "+": "reject", workflow: "'reviewer'" }),
  type({ kind: "string", instruction: "string" }),
  async ({ workflow }, { kind, instruction }, project: Project) => ({
    runs: [
      await project.deploy({
        workflow,
        correlation: "reviewer-" + kind,
        assignment: ({ versions, read }) => {
          if (!versions.has(kind))
            throw new Refusal(
              kind + "_not_filed: write and file the " + kind + " first",
            );
          return writerTask(
            {
              kind: "engineering_review",
              instruction,
              sources: [...versions]
                .filter(
                  ([filed]) => filed === "problem_brief" || filed === kind,
                )
                .map(([, version]) => version),
            },
            read,
          );
        },
      }),
    ],
    notStarted: [],
  }),
);
