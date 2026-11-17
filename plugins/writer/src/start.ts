import { type } from "arktype";
import { defineStarter, type AppStarter } from "@corbits-builder/plugin";
import { WRITER_KINDS, writerTask } from "./task.ts";

// What a build plan may suggest when neither the project nor the person names a stack: each starter
// a first build can start from, in its own words.
const suggestedStarters = (starters: ReadonlyMap<string, AppStarter>) =>
  starters.size === 0
    ? ""
    : "\n\nWhen this is a web app and neither the project nor the person names a stack, suggest the starter that fits from those a first build can start from:\n" +
      [...starters]
        .map(([name, { about }]) => `- ${name}: ${about}`)
        .join("\n");

// A writer writes or revises one document from every other filed document; the build plan alone is
// written from the design, and is offered the starters a first build can start from.
export default defineStarter(
  type({
    "+": "reject",
    workflow: "'writer-product-requirements' | 'writer-build-plan'",
  }),
  type({ instruction: "string" }),
  async ({ workflow }, { instruction }, project) => {
    const kind = WRITER_KINDS[workflow];
    return {
      runs: [
        await project.deploy({
          workflow,
          correlation: "writer-" + kind,
          assignment: ({ versions, document }) =>
            writerTask(
              {
                kind,
                instruction:
                  kind === "build_plan"
                    ? instruction + suggestedStarters(project.appStarters)
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
              document,
            ),
        }),
      ],
      notStarted: [],
    };
  },
);
