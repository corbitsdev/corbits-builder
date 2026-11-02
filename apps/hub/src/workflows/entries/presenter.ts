import { createPresenterAgent } from "@corbits-builder/presenter/agent";
import { createPresenterWorkflow } from "@corbits-builder/presenter";
import { mail, type MailToolEnv } from "@intx/tools-mail/sidecar-bundle";
import {
  createPackageTools,
  type PackageToolEnv,
} from "../../artifacts/package-tools.ts";
import { createSkillTools } from "../../skills/tools.ts";
import { roleInference } from "../role-inference.ts";
import {
  compactingDirector,
  dropDegenerateTurn,
  trimHistory,
} from "../compaction.ts";
import { nativePackageName } from "../package-name.ts";

const compacting = compactingDirector(nativePackageName("presenter"));

const { source, contextWindow, parameters } = roleInference("presenter");
const agent = createPresenterAgent<PackageToolEnv & MailToolEnv>({
  director: compacting.build({
    contextWindow,
    compactAt: 0.6,
  }),
  id: "presenter",
  capabilities: [],
  inference: { ...source, parameters },
  tools: [createPackageTools(), mail, createSkillTools(["presenting"])],
});
const workflow = createPresenterWorkflow({
  id: "corbits-builder-presenter",
  address: "presenter",
  agent,
  inference: { literal: parameters },
  grantRequirements: [
    { resource: "sb-project:*", action: "read", source: "invoker" },
    {
      resource: "sb-artifact:approval_package",
      action: "write",
      source: "invoker",
    },
  ],
});
// The directors module of this package: the director the agent names and the compactors it uses.
export const director = compacting.factory;
export const historyCompactor = trimHistory(
  contextWindow - parameters.maxTokens,
);
export const degenerateTurnCompactor = dropDegenerateTurn;
export default workflow;
