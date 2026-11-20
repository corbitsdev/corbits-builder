import { defineTask, save } from "@corbits-builder/plugin";
import { PLAN, TAKE_DOWN } from "@corbits-builder/publishing";
import { type } from "arktype";
import { GO_AHEAD } from "../go-ahead.ts";

// The person's press of Publish is their go-ahead for one publish by the plan they picked. The hub's
// clock dates it, so it allows the next release recorded after it. Publishing again ends any
// go-ahead to take the app down, so a later take-down asks again.
export default defineTask({
  says: "The person gave the go-ahead to publish.",
  input: type({ "+": "reject", plan: "string > 0" }),
  writes: [GO_AHEAD, PLAN, TAKE_DOWN],
  describe: {
    fields: {
      plan: { about: "The handle of the ready-made publish plan they picked." },
    },
  },
  run: (_project, input) => ({
    saves: [
      save(GO_AHEAD, { plan: input.plan, at: new Date().toISOString() }),
      save(PLAN, input.plan),
      save(TAKE_DOWN, null),
    ],
    adds: { plan: input.plan },
    note: `They gave their go-ahead to publish by ${input.plan}, so publish agreed passes until it goes out.`,
  }),
});
