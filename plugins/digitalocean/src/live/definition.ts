import { defineCheck } from "@corbits-builder/plugin";
import { publishedCheck } from "@corbits-builder/publish-contract";
import { TARGET } from "../target.ts";

export default defineCheck({
  describe: {
    summary:
      "Confirms the release Builder recorded for the server at DigitalOcean is the project's current saved version. It reads that record and never contacts DigitalOcean or the server.",
    when: "After digitalocean publish, to confirm the saved version is the one published.",
    failed:
      "The saved version is not the one published to the server at DigitalOcean: the app was never published there, was taken down, or a newer version was saved since. Start digitalocean publish to publish the saved app, then run it again.",
  },
  run: publishedCheck(TARGET, {
    notPublished: "The app is not published on DigitalOcean",
    earlier: "The server at DigitalOcean holds an earlier version of the app",
  }),
});
