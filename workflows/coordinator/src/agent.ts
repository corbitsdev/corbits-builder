import {
  defineAgent,
  type AnnotatedToolFactory,
  type BaseEnv,
  type DirectorRef,
  type InferencePreference,
} from "@intx/agent/authoring";
import {
  composeCoordinatorPrompt,
  type CoordinatorCalibration,
} from "./prompt.ts";
import { version } from "../package.json";

export function createCoordinatorAgent<Env extends BaseEnv>(options: {
  readonly id: string;
  readonly inference: InferencePreference;
  readonly tools: readonly AnnotatedToolFactory<Env>[];
  readonly director?: DirectorRef;
  readonly capabilities: readonly string[];
  readonly calibration?: CoordinatorCalibration;
}) {
  if (!options.inference.provider.trim() || !options.inference.model.trim()) {
    throw new Error("Coordinator requires an explicit provider and model");
  }
  return defineAgent({
    id: options.id,
    systemPrompt: composeCoordinatorPrompt(options.calibration),
    tools: options.tools,
    ...(options.director ? { director: options.director } : {}),
    capabilities: options.capabilities,
    inference: { sources: [options.inference] },
    tags: {
      "coordinator.version": version,
      ...(options.calibration
        ? {
            "coordinator.calibration":
              options.calibration.id + "@" + options.calibration.version,
          }
        : {}),
    },
  });
}
