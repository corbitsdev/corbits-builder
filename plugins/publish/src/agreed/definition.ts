import { defineCheck, fail, parsed, pass } from "@corbits-builder/plugin";
import {
  PUBLISH_PLAN,
  PUBLISH_RELEASE,
  PublishRelease,
} from "@corbits-builder/plugin/publish";
import { type } from "arktype";
import { PUBLISH_GO_AHEAD, PublishGoAhead } from "../go-ahead.ts";

// The check passes from the person's answer until a release is recorded after it. A publish that
// failed, was blocked or waits on another step carries on under the same go-ahead, and the publish
// that goes out uses it up. Choosing another plan, or agreeing to take the app down, also ends it.
// The fact tells the coordinator not to ask again; no publish requires it.
export default defineCheck({
  describe: {
    summary:
      "Confirms the person's go-ahead to publish, from publish confirm, still stands: it names the plan publish.plan names, when one is chosen, and no release was recorded after it. It reads that answer and the release recorded, and contacts nothing.",
    when: "Before opening publish confirm, and before carrying on with a publish whose attempt failed, was blocked or needed another step first.",
    failed:
      "The person has not agreed to this publish: they were not asked, the publish they agreed to went out, they chose another plan since, or they agreed to take the app down. Open publish confirm with the plan's handle, then go on.",
  },
  run: async (view) => {
    const given = PublishGoAhead(await view.values(PUBLISH_GO_AHEAD));
    if (given instanceof type.errors)
      return fail("The person has not agreed to publish");
    const evidence = [`agreed at ${given.at} to publish by ${given.plan}`];
    const chosen = await view.values(PUBLISH_PLAN);
    if (typeof chosen === "string" && chosen !== given.plan)
      return fail(
        "The person agreed to publish by another plan than the one chosen since",
        [...evidence, `${chosen} chosen since`],
      );
    const release = parsed(PublishRelease(await view.values(PUBLISH_RELEASE)));
    if (release !== undefined && Date.parse(release.at) >= Date.parse(given.at))
      return fail("The publish the person agreed to went out", [
        ...evidence,
        `published ${release.version} at ${release.at}`,
      ]);
    return pass(`The person agreed to publish by ${given.plan}`, evidence);
  },
});
