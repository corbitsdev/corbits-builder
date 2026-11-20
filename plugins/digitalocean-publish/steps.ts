import { publishSteps } from "@corbits-builder/publishing";

export default publishSteps({
  place: "digitalocean",
  ready: "Check your app is ready for a server",
  publish: {
    title: "Publish the app to your server",
    instruction:
      "Publish the project's saved app to the person's server at DigitalOcean, readying the server first if it needs it, and report the address people open it at.",
  },
  own: [
    {
      plugin: "digitalocean",
      action: "account",
      title: "Choose your server and sign in to DigitalOcean",
      requires: ["app_exists"],
    },
    {
      plugin: "digitalocean",
      action: "create",
      title: "Make your server at DigitalOcean",
      requires: ["app_exists", "ready:digitalocean", "agreed:publish"],
    },
  ],
});
