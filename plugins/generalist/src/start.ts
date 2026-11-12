import { type } from "arktype";
import { defineStarter } from "@corbits-builder/plugin-host/catalog";
import type { Project } from "@corbits-builder/plugin-host/coordinator";
import task from "./do.ts";

const GENERALIST_PACKAGE = "generalist";

function file(kind: string, title: string, filed: boolean) {
  const filing = `File the result with write_artifact as kind ${kind}, titled "${title}".`;
  return filed
    ? `${filing} A version of it is already filed: read it with read_artifact first, as yours replaces it.`
    : filing;
}

export default defineStarter(
  type({ "+": "reject", workflow: "'generalist'" }),
  task.input,
  async (_start, { instruction, kind, title }, project: Project) => ({
    runs: [
      await project.deploy({
        workflow: GENERALIST_PACKAGE,
        correlation: GENERALIST_PACKAGE,
        assignment: ({ versions }) =>
          [
            instruction,
            versions.has("app")
              ? "The project has an app: read_artifact with kind app reads its files."
              : "The project has no app yet.",
            kind === undefined || title === undefined
              ? "File nothing: your report is the answer."
              : file(kind, title, versions.has(kind)),
          ].join("\n\n"),
      }),
    ],
    notStarted: [],
  }),
);
