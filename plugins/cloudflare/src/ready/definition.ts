import { defineCheck } from "@corbits-builder/plugin";

export default defineCheck({
  describe: {
    when: "Before deploying to Cloudflare.",
    failed:
      "The app lacks something a Cloudflare Workers deploy needs, or the person has not approved its build plan; the evidence names which. Have the coder add what is missing with coder change, or open writer approve for the build plan, then run it again.",
  },
});
