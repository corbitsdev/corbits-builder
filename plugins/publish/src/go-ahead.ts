import { type } from "arktype";

// The project value for the person's go-ahead to publish. Only the confirm screen writes it. The
// take-down screen clears it once they agree to take the app down.
export const PUBLISH_GO_AHEAD = "publish.go-ahead";

// A go-ahead as the confirm screen records it: the handle of the ready-made plan it is for, and
// when the person gave it, as an ISO time. A screen cannot read the saved app's version, so a
// release recorded after `at` is how anyone tells that the allowed publish went out.
export const PublishGoAhead = type({
  "+": "reject",
  plan: "string > 0",
  at: "string.date.iso",
});
