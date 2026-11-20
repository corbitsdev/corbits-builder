import { defineScreen, type ProjectRead } from "@corbits-builder/plugin";
import {
  HOLDING,
  PUBLISH_GROUP,
  RELEASE,
  REMOVE_ACTION,
  TAKE_DOWN,
  takeDownStands,
} from "@corbits-builder/publishing";
import { type } from "arktype";
import { whereOf, type Where } from "../published/definition.ts";

/** What the person is asked in the conversation: to publish by a plan, or to take the app down. */
export type Asked =
  | { do: "publish"; plan: string; about: string }
  | { do: "take-down"; where: Where };

export const text = {
  publish: "Publish your app?",
};

/**
 * What the conversation asks the person, from the plan: a place's removal waiting on their
 * go-ahead to take down, or a publish plan's publish step waiting on their go-ahead to publish.
 * The coordinator puts either on the plan when the person asks in their own words; their press
 * here runs the same action as on the publish screen.
 */
export function askedOf(project: ProjectRead): Asked | undefined {
  const waiting = project.plan.filter((step) => step.state === "waiting");
  const released = project.value(RELEASE);
  const held = project.value(HOLDING);
  const target = released?.target ?? held?.target;
  if (
    target !== undefined &&
    waiting.some(
      (step) => step.plugin === target && step.action === REMOVE_ACTION,
    ) &&
    !takeDownStands(project.value(TAKE_DOWN), target, released, held)
  )
    return { do: "take-down", where: whereOf(project) };
  if (project.facts.has("agreed:publish")) return undefined;
  const place = project
    .plans(PUBLISH_GROUP)
    .find(({ handle }) =>
      waiting.some((step) => step.plan === handle && step.action === "publish"),
    );
  return place && { do: "publish", plan: place.handle, about: place.about };
}

const Nothing = type({ "+": "reject" });

export default defineScreen({
  state: askedOf,
  input: Nothing,
  output: Nothing,
  describe: {
    summary:
      "Asks the person in the conversation to publish, or to take the app down, once you put that work on the plan for them. Their press is their go-ahead, the same as on the publish screen.",
    when: "Never open it: it shows by itself while the plan waits on their go-ahead.",
    unless: "Always: it shows by itself.",
    fields: {},
  },
});
