import { publishSteps } from "@corbits-builder/publish-contract";

export default publishSteps({
  handle: "publish-to-digitalocean",
  target: "digitalocean",
  ready: "Check your app is ready for a server",
  publish: {
    title: "Publish the app to your server",
    instruction:
      "Publish the project's saved app to the person's server at DigitalOcean, readying the server first if it needs it, and report the address people open it at.",
  },
  asks: [
    {
      action: "account",
      title: "Choose your server and sign in to DigitalOcean",
    },
  ],
  makes: [{ action: "create", title: "Make your server at DigitalOcean" }],
});
