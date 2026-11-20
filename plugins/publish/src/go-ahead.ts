import { defineValue } from "@corbits-builder/plugin";
import type { PublishRelease } from "@corbits-builder/publishing";
import { type } from "arktype";

// A go-ahead as the publish action records it: the handle of the ready-made plan it is for, and
// when the person gave it, as an ISO time. A release recorded after `at` is how anyone tells that
// the allowed publish went out.
export const PublishGoAhead = type({
  "+": "reject",
  plan: "string > 0",
  at: "string.date.iso",
});
export type PublishGoAhead = typeof PublishGoAhead.infer;

export const GO_AHEAD = defineValue(
  "publish.go-ahead",
  PublishGoAhead,
  'The person\'s go-ahead to publish, from the publish screen, as { "plan": the handle of the ready-made plan it is for, "at": when they gave it, as an ISO time }; null once they agreed to take the app down, and none while they never gave one. It stands until a release is recorded after it, as publish agreed says. Only the publish plugin\'s actions set it.',
);

/**
 * Why the person's go-ahead to publish does not stand, or undefined when it does: it names the plan
 * chosen since, when one is, and no release was recorded after it. The publish that goes out uses it
 * up; one that failed or waits on another step carries on under it.
 */
export function goAheadLapsed(
  given: PublishGoAhead | undefined,
  chosen: string | undefined,
  released: PublishRelease | undefined,
) {
  if (given === undefined) return "The person has not agreed to publish";
  if (chosen !== undefined && chosen !== given.plan)
    return "The person agreed to publish by another plan than the one chosen since";
  if (released !== undefined && Date.parse(released.at) >= Date.parse(given.at))
    return "The publish the person agreed to went out";
  return undefined;
}
