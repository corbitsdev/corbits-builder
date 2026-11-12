import { type } from "arktype";
import { defineStarter } from "@corbits-builder/plugin-host/catalog";
import type { Project } from "@corbits-builder/plugin-host/coordinator";
import { DOCUMENT_WRITER_PACKAGE } from "@corbits-builder/schemas/installed-workflows";
import { writerTask } from "./task.ts";

// Any document the coordinator names, written from every other filed document. The known kinds
// keep their own writers for the fields and templates those carry.
export default defineStarter(
  type({ "+": "reject", workflow: "'writer-document'" }),
  type({ kind: "string", title: "string", instruction: "string" }),
  async (_start, { kind, title, instruction }, project: Project) => ({
    runs: [
      await project.deploy({
        workflow: DOCUMENT_WRITER_PACKAGE,
        correlation: "writer-" + kind,
        assignment: ({ versions, read }) =>
          writerTask(
            {
              kind,
              instruction: `Title: ${title}\n\n${instruction}`,
              sources: [...versions]
                .filter(([filed]) => filed !== "app" && filed !== kind)
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
