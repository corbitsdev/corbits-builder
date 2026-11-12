import {
  defineAgent,
  type AnnotatedToolFactory,
  type BaseEnv,
  type DirectorRef,
  type InferencePreference,
} from "@intx/agent/authoring";
import { generalistPrompt } from "./prompt.ts";
import { version } from "../package.json";

export function createGeneralistAgent<Env extends BaseEnv>(options: {
  readonly inference: InferencePreference;
  readonly tools: readonly AnnotatedToolFactory<Env>[];
  readonly director: DirectorRef;
}) {
  if (!options.inference.provider.trim() || !options.inference.model.trim())
    throw new Error("Generalist requires an explicit provider and model");
  return defineAgent({
    id: "generalist",
    systemPrompt: generalistPrompt,
    tools: options.tools,
    director: options.director,
    capabilities: [],
    inference: { sources: [options.inference] },
    tags: { "generalist.version": version },
  });
}
