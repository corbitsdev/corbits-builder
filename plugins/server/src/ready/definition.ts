import { defineCheck } from "@corbits-builder/plugin";
import { productionReady } from "@corbits-builder/ssh-publish/ready";

export default defineCheck({
  describe: {
    summary:
      "Proves the saved app says how it runs in production, as a publish to the person's own server needs: the commands that install, build and start it, the variable it answers on and the folders that keep what people enter.",
    when: "Before publishing to the person's own server, and again after the app was changed to say how it runs in production.",
    failed:
      "The app does not say how it runs in production, so it cannot be published to a server yet; the evidence names what falls short. Start coder change to make the app ready to publish as the publish skill pack describes, naming what the evidence says, then run it again. Nothing on the server needs doing and the person does nothing technical.",
  },
  run: productionReady,
});
