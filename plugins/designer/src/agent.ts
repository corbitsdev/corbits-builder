import {
  defineAgent,
  type AnnotatedToolFactory,
  type BaseEnv,
  type DirectorRef,
  type InferencePreference,
} from "@intx/agent/authoring";
import { ROLE_TAG } from "@corbits-builder/plugin";
import { designerPrompt } from "./prompt.ts";

export function createDesignerAgent<Env extends BaseEnv>(options: {
  readonly id: string;
  // The role it plays, which the hub tells its runs by.
  readonly role: string;
  readonly inference: InferencePreference;
  readonly tools: readonly AnnotatedToolFactory<Env>[];
  readonly director?: DirectorRef;
  readonly standards: readonly string[];
}) {
  if (!options.inference.provider.trim() || !options.inference.model.trim())
    throw new Error("Designer requires an explicit provider and model");
  return defineAgent({
    id: options.id,
    systemPrompt: [designerPrompt, ...options.standards].join("\n\n"),
    tools: options.tools,
    ...(options.director ? { director: options.director } : {}),
    capabilities: [],
    inference: { sources: [options.inference] },
    tags: { [ROLE_TAG]: options.role },
  });
}
