import { publishSteps } from "@corbits-builder/publish-contract";

export default publishSteps({
  handle: "publish-to-cloudflare",
  target: "cloudflare",
  ready: "Check your app is ready for Cloudflare",
  publish: {
    title: "Publish the app to Cloudflare",
    instruction:
      "Publish the project's saved app to Cloudflare and report the address people open it at, and, when it went out without the person's own Cloudflare account, how long they have to keep it.",
  },
});
