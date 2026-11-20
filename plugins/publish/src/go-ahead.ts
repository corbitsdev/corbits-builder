import { type } from "arktype";

// The group that every target and every ready-made plan that publishes the app lists, so the
// publish plugin finds them without naming a plugin.
export const PUBLISH_GROUP = "publish";

// The project value holding the handle of the ready-made publish plan the person chose, when more
// than one is installed.
export const PUBLISH_PLAN = "publish.plan";

// The project value for the person's go-ahead to publish. Only the confirm screen writes it. The
// take-down screen clears it once they agree to take the app down.
export const PUBLISH_GO_AHEAD = "publish.go-ahead";

// A go-ahead as the confirm screen records it: the handle of the ready-made plan it is for, and
// when the person gave it, as an ISO time. An answer's saved values cannot read the saved app's
// version, so a release recorded after `at` is how anyone tells that the allowed publish went out.
export const PublishGoAhead = type({
  "+": "reject",
  plan: "string > 0",
  at: "string.date.iso",
});

// The project value for the person's latest ask to publish or to take the app down: a press in the
// Publish tab, or a go-ahead given on publish confirm or publish take-down. The hub's clock dates
// it. The tab shows the work under way from it until the coordinator takes it up.
export const PUBLISH_ASKED = "publish.asked";

export const PublishAsked = type({
  "+": "reject",
  kind: "'publish' | 'takeDown'",
  at: "string.date.iso",
});
export type PublishAsked = typeof PublishAsked.infer;
