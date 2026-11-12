import type { WriterDocumentKind } from "@corbits-builder/schemas/artifact";
import {
  createDocumentWriterArtifactTools,
  createWriterArtifactTools,
} from "@corbits-builder/hub/artifacts/tools";
import { createSkillTools } from "@corbits-builder/hub/skills/tools";
import { roleInference } from "@corbits-builder/hub/workflows/role-inference";
import { compactingDirector } from "@corbits-builder/hub/workflows/director";
import {
  dropDegenerateTurn,
  trimHistory,
} from "@corbits-builder/hub/workflows/compaction";
import { savedResultTools } from "@corbits-builder/hub/workflows/saved-result-tools";
import { nativePackageName } from "@corbits-builder/hub/workflows/package-name";
import { createWriterAgent } from "./agent.ts";
import { createWriterWorkflow } from "./workflow.ts";
import { DOCUMENT_WRITER_PACKAGE, WRITER_PACKAGES } from "./task.ts";

/**
 * The writer's workflow package for one known kind, whose write_artifact saves only that kind, or
 * with no kind the writer of any document, which saves it under the kind it names.
 */
export function writerPackage(kind?: WriterDocumentKind) {
  const name =
    kind === undefined ? DOCUMENT_WRITER_PACKAGE : WRITER_PACKAGES[kind];
  const compacting = compactingDirector(nativePackageName(name));
  const { source, contextWindow, timeouts, parameters } =
    roleInference("writer");
  const agent = createWriterAgent({
    director: compacting.build({
      contextWindow,
      timeouts,
      compactAt: 0.6,
      fileBeforeDone: true,
    }),
    id: "document-writer",
    capabilities: [],
    inference: { ...source, parameters },
    tools: [
      kind === undefined
        ? createDocumentWriterArtifactTools()
        : createWriterArtifactTools(kind),
      createSkillTools([
        "constraints",
        "approaches",
        "product-requirements",
        "build-plan",
      ]),
      savedResultTools,
    ],
  });
  return {
    workflow: createWriterWorkflow({
      id: "corbits-builder-" + name,
      address: "writer",
      agent,
      inference: { literal: parameters },
      grantRequirements: [
        { resource: "sb-project:*", action: "read", source: "invoker" },
        { resource: "sb-artifact:*", action: "write", source: "invoker" },
      ],
    }),
    // The directors module of this package: the director the agent names and the compactors it uses.
    director: compacting.factory,
    historyCompactor: trimHistory(contextWindow - parameters.maxTokens),
    degenerateTurnCompactor: dropDegenerateTurn,
  };
}
