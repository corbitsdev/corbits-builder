import { type } from "arktype";
import { defineStarter } from "@corbits-builder/plugin-host/catalog";
import type { Project } from "@corbits-builder/plugin-host/coordinator";
import { WEB_APP_STACK, WRITER_PACKAGES, writerTask } from "./task.ts";

// A writer writes or revises one document from every other filed document; the build plan alone is
// written from the design, and is offered the web stack for a web app that has none named.
export default defineStarter(
  type({
    "+": "reject",
    workflow: "'writer'",
    kind: "'product_requirements' | 'build_plan'",
  }),
  type({ instruction: "string" }),
  async ({ kind }, { instruction }, project: Project) => ({
    runs: [
      await project.deploy({
        workflow: WRITER_PACKAGES[kind],
        correlation: "writer-" + kind,
        assignment: ({ versions, read }) =>
          writerTask(
            {
              kind,
              instruction:
                kind === "build_plan"
                  ? instruction +
                    "\n\nWhen this is a web app and neither the project nor the person names a stack, the suggested one is " +
                    WEB_APP_STACK
                  : instruction,
              sources: [...versions]
                .filter(
                  ([filed]) =>
                    filed !== "app" &&
                    filed !== kind &&
                    (filed !== "design" || kind === "build_plan"),
                )
                .map(([, version]) => version),
              current: versions.get(kind),
            },
            read,
          ),
      }),
    ],
    notStarted: [],
  }),
);
