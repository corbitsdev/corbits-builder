import { defineScreen } from "@corbits-builder/plugin";
import { PUBLISH_PLAN } from "@corbits-builder/plugin/publish";
import { Input, Output } from "./schema.ts";

export const text = {
  title: "Where should your app be published?",
  plans: "Places to publish",
  choose: "Continue",
  none: "There's nowhere to publish to yet.",
  orWrite: "Or write below what you want instead.",
};

export default defineScreen({
  input: Input,
  output: Output,
  // The host draws a screen only once it is prepared. This one needs nothing beyond its input.
  prepare: (input) => input,
  writes: { [PUBLISH_PLAN]: (output) => output.plan },
  describe: {
    says: {
      label: () => text.title,
    },
    summary:
      "Lists the ready-made plans in the publish group that are installed, each in its own words, and asks the person where the app should be published. Builder lists the plans itself; pass nothing. The answer is { plan }, the chosen plan's handle, saved as the project value publish.plan; that plan is how the app is published from then on. If they write back instead, what they wrote is their answer.",
    when: "The person wants the app published, more than one ready-made publish plan is installed, and they have not chosen one yet or want it published somewhere else.",
    unless:
      "Only one publish plan is installed, which is then where the app goes; or publish.plan already names their choice and they did not ask to change it.",
    fields: {},
  },
});
