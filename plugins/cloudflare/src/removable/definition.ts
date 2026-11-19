import { defineCheck } from "@corbits-builder/plugin";
import { removableCheck } from "@corbits-builder/publish-contract";
import { TARGET } from "../target.ts";

export default defineCheck({
  describe: {
    summary:
      "Confirms the person agreed, on publish take-down, to take down the app as it is published on Cloudflare now. It reads that answer and the release Builder recorded, and never contacts Cloudflare.",
    when: "After the person answered publish take-down for the Cloudflare plan, before cloudflare remove.",
    failed:
      "The person has not agreed to take down the app as it is published on Cloudflare now: they were not asked, kept it, or it was published again since. Open publish take-down with the Cloudflare plan's handle, then run this again.",
  },
  run: removableCheck(TARGET, {
    notAsked: "The person has not asked to take the app down from Cloudflare",
    earlier: "The person agreed to take down an earlier release on Cloudflare",
  }),
});
