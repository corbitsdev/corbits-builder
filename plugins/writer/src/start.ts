import { type } from "arktype";
import { defineStarter } from "@corbits-builder/plugin-host/catalog";
import type { Project } from "@corbits-builder/plugin-host/coordinator";
import { WRITER_PACKAGES } from "@corbits-builder/schemas/installed-workflows";
import { DEFAULT_STACK, writerTask } from "./task.ts";

// A writer writes or revises one document from every other filed document; the build plan alone is
// written from the design, and to the default stack unless the person asked otherwise.
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
                    "\n\nDefault stack unless the person asked otherwise: " +
                    DEFAULT_STACK
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
