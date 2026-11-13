import type { WriterDocumentKind } from "@corbits-builder/schemas/artifact";
import {
  createArtifactTools,
  createWriterArtifactTools,
} from "@corbits-builder/hub/artifacts/tools";
import { declaredRole } from "@corbits-builder/plugin";
import manifest from "../package.json";
import { createSkillTools } from "@corbits-builder/hub/skills/tools";
import { roleInference } from "@corbits-builder/hub/workflows/role-inference";
import { compactingDirector } from "@corbits-builder/hub/workflows/director";
import { createBlockedTools } from "@corbits-builder/hub/workflows/blocked";
import {
  dropDegenerateTurn,
  trimHistory,
} from "@corbits-builder/hub/workflows/compaction";
import { savedResultTools } from "@corbits-builder/hub/workflows/saved-result-tools";
import { nativePackageName } from "@corbits-builder/hub/workflows/package-name";
import { createWriterAgent } from "./agent.ts";
import { documentSkills } from "./skills.ts" with { type: "macro" };
import { createWriterWorkflow } from "./workflow.ts";
import { DOCUMENT_WRITER_PACKAGE, WRITER_PACKAGES } from "./task.ts";

/**
 * The writer's workflow package for one known kind, whose write_artifact saves only that kind, or
 * with no kind the writer of any document, which saves it under the kind it names.
 */
export function writerPackage(kind?: WriterDocumentKind) {
  const name =
    kind === undefined ? DOCUMENT_WRITER_PACKAGE : WRITER_PACKAGES[kind];
  const role = declaredRole(manifest.builder);
  const compacting = compactingDirector(nativePackageName(name));
  const { source, contextWindow, timeouts, parameters } = roleInference(
    role.name,
  );
  const agent = createWriterAgent({
    director: compacting.build({
      contextWindow,
      timeouts,
      compactAt: 0.6,
      fileBeforeDone: true,
    }),
    id: "document-writer",
    role: role.name,
    capabilities: [],
    inference: { ...source, parameters },
    tools: [
      kind === undefined
        ? createArtifactTools(role)
        : createWriterArtifactTools(role, kind),
      createSkillTools(documentSkills()),
      savedResultTools,
      createBlockedTools(role.name),
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
