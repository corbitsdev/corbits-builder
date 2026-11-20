import { publishSteps } from "@corbits-builder/publish-contract";

export default publishSteps({
  handle: "publish-to-server",
  target: "server",
  ready: "Check your app is ready for your server",
  publish: {
    title: "Publish the app to your server",
    instruction:
      "Publish the project's saved app to the person's own server, readying the server first if it needs it, and report the address people open it at.",
  },
});
