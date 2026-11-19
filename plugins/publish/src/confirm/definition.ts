import { defineScreen, parsed } from "@corbits-builder/plugin";
import {
  PUBLISH_KEEP,
  PUBLISH_RELEASE,
  PUBLISH_TAKE_DOWN,
  PublishKeep,
  PublishRelease,
} from "@corbits-builder/publish-contract";
import { PUBLISH_GO_AHEAD, PUBLISH_GROUP } from "../go-ahead.ts";
import { Input, Output } from "./schema.ts";

// A publish replaces what people open only when a plugin of the chosen plan recorded the release
// and can update it. Otherwise the app goes to a new address. A first publish says where it goes in
// the plan's words. A publish of changes says only that the current address will show the latest
// saved version, because the rest was said the first time.
export const text = {
  title: (changes: boolean) =>
    changes ? "Publish your changes?" : "Publish your app?",
  // The text before and after the address, which the view renders as a link.
  replaces: {
    before: "People who open ",
    after: " will see the version you saved last.",
  },
  elsewhere: {
    before: "It gets a new address. People who open ",
    after: " keep seeing the earlier version.",
  },
  anyone: "Anyone who has its address can open it.",
  go: (changes: boolean) => (changes ? "Publish changes" : "Publish"),
  orWrite: "Or write below what you want instead.",
};

export default defineScreen({
  input: Input,
  output: Output,
  // Whether this publish replaces the address people open now or goes to a new one. A release that
  // cannot be updated was made in an account the person does not hold yet; once they kept it and
  // the way to keep it is cleared, the next publish there updates it.
  fromProject: ({ plan }, project) => {
    const release = parsed(PublishRelease(project.value(PUBLISH_RELEASE)));
    const keeping =
      parsed(PublishKeep(project.value(PUBLISH_KEEP))) !== undefined;
    const offered = project
      .plans(PUBLISH_GROUP)
      .find(({ handle }) => handle === plan);
    return {
      plan,
      url: release?.url,
      changes:
        release !== undefined &&
        (release.replaceable !== false || !keeping) &&
        offered?.plugins.includes(release.target) === true,
      firstRun: offered?.firstRun,
    };
  },
  // The go-ahead is for the plan the person agreed to, from the time they agreed. The hub's clock
  // dates it, so it allows the next publish recorded after it. Publishing again ends any go-ahead
  // to take the app down, so a later take-down asks again.
  writes: {
    [PUBLISH_GO_AHEAD]: ({ plan }) => ({
      plan,
      at: new Date().toISOString(),
    }),
    [PUBLISH_TAKE_DOWN]: () => null,
  },
  describe: {
    says: {
      label: () => text.title(false),
      chose: () => text.go(false),
    },
    summary:
      "Asks the person for their go-ahead to publish, saying only what they need to decide: for a first publish, where the app goes in the chosen plan's own words and that anyone with its address can open it; for changes, that the address people use now will show the version saved last; and, where this publish cannot update what people open now, that it gets a new address. The answer { go: true, plan } is their go-ahead, saved as publish.go-ahead, and publish agreed then passes until the app is published by it. If they write back instead, what they wrote is their answer, and nothing is published on it.",
    when: "The person asked to publish the app, or its changes, and publish agreed does not pass: they have not given their go-ahead for this publish yet.",
    unless:
      "publish agreed passes. The go-ahead is for the publish the person asked for, not for each attempt: when an attempt fails, is blocked or needs another step first, such as a screen, a new server or a change to the app so it can be published, carry on under the same go-ahead. Open this again only when the person asks to publish anew, or the app changed at their request since they agreed.",
    fields: {
      plan: {
        about:
          "The handle of the ready-made publish plan the app is published by: the one publish.plan names, or the only one installed.",
      },
    },
  },
});
