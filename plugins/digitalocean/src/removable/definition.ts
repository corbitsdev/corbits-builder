import { defineCheck } from "@corbits-builder/plugin";
import { removableCheck } from "@corbits-builder/publishing";
import { TARGET } from "../target.ts";

export default defineCheck({
  describe: {
    summary:
      "Confirms the person confirmed Take it down to delete the server at DigitalOcean with the app as it is published or held there now. It reads that answer and what Builder recorded, and never contacts DigitalOcean.",
    when: "After the person confirmed Take it down, before digitalocean remove.",
    failed:
      "The person has not agreed to delete the server at DigitalOcean as it is now: they were not asked, kept it, or the app was published again since. Add digitalocean remove to the plan so Builder asks them in the conversation, or tell them to confirm Take it down on the publish screen; nothing is taken down without it.",
  },
  run: removableCheck(TARGET, {
    notAsked: "The person has not asked to take the app down from DigitalOcean",
    earlier:
      "The person agreed to take down an earlier release or server at DigitalOcean",
  }),
});
