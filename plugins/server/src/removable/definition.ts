import { defineCheck } from "@corbits-builder/plugin";
import { removableCheck } from "@corbits-builder/publishing";
import { TARGET } from "../target.ts";

export default defineCheck({
  describe: {
    summary:
      "Confirms the person confirmed Take it down to take down the app as it is published on their own server now. It reads that answer and the release Builder recorded, and never contacts the server.",
    when: "After the person confirmed Take it down, before server remove.",
    failed:
      "The person has not agreed to take down the app as it is published on their server now: they were not asked, kept it, or it was published again since. Add server remove to the plan so Builder asks them in the conversation, or tell them to confirm Take it down on the publish screen; nothing is taken down without it.",
  },
  run: removableCheck(TARGET, {
    notAsked: "The person has not asked to take the app down from their server",
    earlier:
      "The person agreed to take down an earlier release on their server",
  }),
});
