import { defineCheck } from "@corbits-builder/plugin";
import { removableCheck } from "@corbits-builder/plugin/publish";
import { TARGET } from "../target.ts";

export default defineCheck({
  describe: {
    summary:
      "Confirms the person agreed, on publish take-down, to delete the server at DigitalOcean with the app as it is published or held there now. It reads that answer and what Builder recorded, and never contacts DigitalOcean.",
    when: "After the person answered publish take-down for the DigitalOcean plan, before digitalocean remove.",
    failed:
      "The person has not agreed to delete the server at DigitalOcean as it is now: they were not asked, kept it, or the app was published again since. Open publish take-down with the DigitalOcean plan's handle, then run this again.",
  },
  run: removableCheck(TARGET, {
    notAsked: "The person has not asked to take the app down from DigitalOcean",
    earlier:
      "The person agreed to take down an earlier release or server at DigitalOcean",
  }),
});
