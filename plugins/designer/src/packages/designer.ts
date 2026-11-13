import { mail, type MailToolEnv } from "@intx/tools-mail/sidecar-bundle";
import {
  createSidecarCodingTools,
  type CodingSidecarEnv,
} from "@corbits-builder/hub/builds/sidecar-tools";
import { createDesignTools } from "@corbits-builder/hub/artifacts/design-tools";
import { roleInference } from "@corbits-builder/hub/workflows/role-inference";
import { compactingDirector } from "@corbits-builder/hub/workflows/director";
import {
  dropDegenerateTurn,
  trimHistory,
} from "@corbits-builder/hub/workflows/compaction";
import { nativePackageName } from "@corbits-builder/hub/workflows/package-name";
import { presentsFor } from "@corbits-builder/hub/plugins/catalog";
import { declaredRole } from "@corbits-builder/plugin";
import manifest from "../../package.json";
import { createDesignerAgent } from "../agent.ts";
import { createDesignerWorkflow } from "../workflow.ts";

const role = declaredRole(manifest.builder);
const compacting = compactingDirector(nativePackageName("designer"));

const { source, contextWindow, timeouts, parameters } = roleInference(
  role.name,
);
const agent = createDesignerAgent<CodingSidecarEnv & MailToolEnv>({
  director: compacting.build({
    contextWindow,
    timeouts,
    compactAt: 0.6,
    checkBeforeDone: true,
    fileBeforeDone: true,
    presents: presentsFor("designer"),
  }),
  id: "designer",
  role: role.name,
  standards: [],
  inference: { ...source, parameters },
  tools: [
    createDesignTools(role.name),
    mail,
    createSidecarCodingTools({
      role: role.name,
      approval: "allow",
      workspace: "design",
    }),
  ],
});
const workflow = createDesignerWorkflow({
  id: "corbits-builder-designer",
  address: "designer",
  agent,
  inference: { literal: parameters },
  grantRequirements: [
    { resource: "sb-project:*", action: "read", source: "invoker" },
    {
      resource: "sb-artifact:design_option",
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
