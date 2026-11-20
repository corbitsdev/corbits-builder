import { defineTask, parsed } from "@corbits-builder/plugin";
import {
  PUBLISH_HOLDING,
  PUBLISH_KEEP,
  PUBLISH_RELEASE,
  PUBLISH_TAKE_DOWN,
  PublishHolding,
  PublishRelease,
} from "@corbits-builder/publish-contract";
import { type } from "arktype";

/**
 * The person says something is gone that Builder cannot see, which clears its record:
 * - keep: they did not keep an app on a temporary account before its deadline, so its place removed
 *   it, and its release no longer says where the app is.
 * - holding: they removed what a target held for them themselves. An app published on that target
 *   went with it, so that target's release goes too.
 * - release: no take-down could reach an app they removed themselves, as by cancelling its server.
 *   Once the release is cleared, so is the go-ahead to take it down.
 */
export default defineTask({
  says: "The person said something Builder published or holds is gone.",
  input: type({ "+": "reject", what: "'keep' | 'holding' | 'release'" }),
  describe: {
    fields: {
      what: { about: "What is gone: keep, holding or release." },
    },
  },
  writes: [PUBLISH_KEEP, PUBLISH_RELEASE, PUBLISH_HOLDING, PUBLISH_TAKE_DOWN],
  run: (project, { what }) => {
    const cleared = (...names: string[]) => ({
      saves: names.map((name) => ({ name, value: null })),
    });
    if (what === "keep") return cleared(PUBLISH_KEEP, PUBLISH_RELEASE);
    if (what === "release") return cleared(PUBLISH_RELEASE, PUBLISH_TAKE_DOWN);
    const holding = parsed(PublishHolding(project.value(PUBLISH_HOLDING)));
    const release = parsed(PublishRelease(project.value(PUBLISH_RELEASE)));
    return holding !== undefined && holding.target === release?.target
      ? cleared(PUBLISH_HOLDING, PUBLISH_RELEASE)
      : cleared(PUBLISH_HOLDING);
  },
});
