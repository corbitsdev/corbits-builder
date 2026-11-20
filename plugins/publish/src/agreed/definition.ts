import { defineCheck, fail, pass } from "@corbits-builder/plugin";
import { PLAN, RELEASE } from "@corbits-builder/publishing";
import { GO_AHEAD, goAheadLapsed } from "../go-ahead.ts";

// The check passes from the person's go-ahead until a release is recorded after it. Choosing
// another plan, or agreeing to take the app down, also ends it. Each place's publish requires the
// fact, so the hub refuses a publish the person did not agree to.
export default defineCheck({
  describe: {
    summary:
      "Confirms the person's go-ahead to publish, from the publish screen, still stands: it names the plan publish.plan names, when one is chosen, and no release was recorded after it. It reads that go-ahead and the release recorded, and contacts nothing.",
    when: "Before starting a place's publish, and before carrying on with a publish whose attempt failed, was blocked or needed another step first.",
    failed:
      "The person has not agreed to this publish: they did not press Publish, the publish they agreed to went out, they chose another plan since, or they agreed to take the app down. Put the publish plan on the plan so Builder asks them in the conversation, or tell them to press Publish on the publish screen; nothing is published without it.",
  },
  run: async (view) => {
    const given = await view.value(GO_AHEAD);
    const released = await view.value(RELEASE);
    const lapsed = goAheadLapsed(given, await view.value(PLAN), released);
    const evidence =
      given === undefined
        ? []
        : [`agreed at ${given.at} to publish by ${given.plan}`];
    if (lapsed !== undefined)
      return fail(
        lapsed,
        released === undefined
          ? evidence
          : [...evidence, `published ${released.version} at ${released.at}`],
      );
    return pass(`The person agreed to publish by ${given?.plan}`, evidence);
  },
});
