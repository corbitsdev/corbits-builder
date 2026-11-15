import { createPresenterAgent } from "../agent.ts";
import { createPresenterWorkflow } from "../workflow.ts";
import { mail, type MailToolEnv } from "@intx/tools-mail/sidecar-bundle";
import {
  createPackageTools,
  type PackageToolEnv,
} from "@corbits-builder/hub/artifacts/package-tools";
import { createSkillTools } from "@corbits-builder/hub/skills/tools";
import { roleInference } from "@corbits-builder/hub/workflows/role-inference";
import { compactingDirector } from "@corbits-builder/hub/workflows/director";
import {
  dropDegenerateTurn,
  trimHistory,
} from "@corbits-builder/hub/workflows/compaction";
import { createInputFileTools } from "@corbits-builder/hub/workflows/input-file-tools";
import { nativePackageName } from "@corbits-builder/hub/workflows/package-name";

const compacting = compactingDirector(nativePackageName("presenter"));

const { source, contextWindow, timeouts, parameters } =
  roleInference("presenter");
const agent = createPresenterAgent<PackageToolEnv & MailToolEnv>({
  director: compacting.build({
    contextWindow,
    timeouts,
    compactAt: 0.6,
    fileBeforeDone: true,
  }),
  id: "presenter",
  capabilities: [],
  inference: { ...source, parameters },
  tools: [
    createPackageTools(),
    mail,
    createSkillTools(["presenting"]),
    createInputFileTools("presenter"),
  ],
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
