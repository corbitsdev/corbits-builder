import { defineTask, save } from "@corbits-builder/plugin";
import {
  HOLDING,
  recordedFor,
  RELEASE,
  REMOVE_ACTION,
  TAKE_DOWN,
} from "@corbits-builder/publishing";
import { type } from "arktype";
import { GO_AHEAD } from "../go-ahead.ts";

// The person confirmed on the publish screen. Their go-ahead covers exactly the release and the
// holding recorded now, and ends any go-ahead to publish, so a later publish asks again.
export default defineTask({
  says: "The person agreed to take the app down.",
  input: type({ "+": "reject" }),
  writes: [TAKE_DOWN, GO_AHEAD],
  describe: {
    fields: {},
  },
  run: (project) => {
    const released = project.value(RELEASE);
    const held = project.value(HOLDING);
    const target = released?.target ?? held?.target;
    if (target === undefined)
      return {
        saves: [],
        note: "Nothing is published or held, so nothing was taken down.",
      };
    const recorded = recordedFor(target, released, held);
    const agreed: { target: string; release?: string; holding?: string } = {
      target,
    };
    if (recorded.release !== undefined) agreed.release = recorded.release;
    if (recorded.holding !== undefined) agreed.holding = recorded.holding;
    return {
      saves: [save(TAKE_DOWN, agreed), save(GO_AHEAD, null)],
      adds: {
        plugin: target,
        action: REMOVE_ACTION,
        title: "Take your app down",
      },
      note: `They agreed to take down what ${target} published or holds now, so removable:${target} passes.`,
    };
  },
});
