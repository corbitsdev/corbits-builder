import {
  defineAgent,
  type AnnotatedToolFactory,
  type BaseEnv,
  type DirectorRef,
  type InferencePreference,
} from "@intx/agent/authoring";
import { writerPrompt } from "./prompt.ts";
import { version } from "../package.json";

export function createWriterAgent<Env extends BaseEnv>(options: {
  readonly id: string;
  readonly inference: InferencePreference;
  readonly tools: readonly AnnotatedToolFactory<Env>[];
  readonly director?: DirectorRef;
  readonly capabilities: readonly string[];
}) {
  if (!options.inference.provider.trim() || !options.inference.model.trim())
    throw new Error("Writer requires an explicit provider and model");
  return defineAgent({
    id: options.id,
    systemPrompt: writerPrompt,
    tools: options.tools,
    ...(options.director ? { director: options.director } : {}),
    capabilities: options.capabilities,
    inference: { sources: [options.inference] },
    tags: { "writer.version": version },
  });
}
