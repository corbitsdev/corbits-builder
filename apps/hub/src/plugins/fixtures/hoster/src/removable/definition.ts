import { defineCheck } from "@corbits-builder/plugin";
import { removableCheck } from "@corbits-builder/publish-contract";

export default defineCheck({
  describe: {
    summary:
      "Confirms the person agreed to take down what Hoster published or holds now.",
    when: "Before hoster remove.",
    failed: "The person has not agreed to take down what Hoster holds now.",
  },
  run: removableCheck("hoster", {
    notAsked: "The person has not asked to take the app down from Hoster",
    earlier: "The person agreed to take down an earlier release on Hoster",
  }),
});
