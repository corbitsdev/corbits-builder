import { createDesignerAgent } from "@corbits-builder/designer/agent";
import { createDesignerWorkflow } from "@corbits-builder/designer";
import { mail, type MailToolEnv } from "@intx/tools-mail/sidecar-bundle";
import {
  createSidecarCodingTools,
  type CodingSidecarEnv,
} from "../../builds/sidecar-tools.ts";
import { createDesignTools } from "../../artifacts/design-tools.ts";
import { roleInference } from "../role-inference.ts";
import {
  compactingDirector,
  dropDegenerateTurn,
  trimHistory,
} from "../compaction.ts";
import { nativePackageName } from "../package-name.ts";

const compacting = compactingDirector(nativePackageName("designer"));

const { source, contextWindow, parameters } = roleInference("designer");
const agent = createDesignerAgent<CodingSidecarEnv & MailToolEnv>({
  director: compacting.build({
    contextWindow,
    compactAt: 0.6,
    checkBeforeDone: true,
  }),
  id: "designer",
  standards: [],
  inference: { ...source, parameters },
  tools: [
    createDesignTools(),
    mail,
    createSidecarCodingTools({ approval: "allow", workspace: "design" }),
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
