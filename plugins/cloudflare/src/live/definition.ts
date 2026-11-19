import { defineCheck } from "@corbits-builder/plugin";
import { publishedCheck } from "@corbits-builder/publish-contract";
import { TARGET } from "../target.ts";

// Compares the release this target recorded with the saved app's version, without contacting
// Cloudflare. It says what was published, not that Cloudflare still serves it: Cloudflare removes
// an app nobody kept without telling Builder, and this check still passes.
export default defineCheck({
  describe: {
    summary:
      "Proves the app last published to Cloudflare is the project's current saved version.",
    when: "After cloudflare publish, to confirm what was published to Cloudflare is the app as saved now.",
    failed:
      "Cloudflare does not hold the app as saved now: it was never published there, was taken down, or a newer version was saved since. Start cloudflare publish to publish the saved app, then run it again.",
  },
  run: publishedCheck(TARGET, {
    notPublished: "The app is not published on Cloudflare",
    earlier: "Cloudflare holds an earlier version of the app",
  }),
});
