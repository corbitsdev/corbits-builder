import { defineCheck } from "@corbits-builder/plugin";
import { publishedCheck } from "@corbits-builder/publishing";
import { TARGET } from "../target.ts";

export default defineCheck({
  describe: {
    summary:
      "Confirms the release Builder recorded for the person's own server is the project's current saved version. It reads that record and never contacts the server.",
    when: "After server publish, to confirm the saved version is the one published.",
    failed:
      "The saved version is not the one published to the server: the app was never published there, was taken down, or a newer version was saved since. Start server publish to publish the saved app, then run it again.",
  },
  run: publishedCheck(TARGET, {
    notPublished: "The app is not published on the person's server",
    earlier: "The server holds an earlier version of the app",
  }),
});
