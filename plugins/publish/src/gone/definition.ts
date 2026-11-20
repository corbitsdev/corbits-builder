import { defineTask, save } from "@corbits-builder/plugin";
import { HOLDING, KEEP, RELEASE } from "@corbits-builder/publishing";
import { type } from "arktype";

export default defineTask({
  says: "The person said the app is already gone.",
  input: type({ "+": "reject" }),
  writes: [RELEASE, HOLDING, KEEP],
  describe: {
    fields: {},
  },
  run: () => ({
    saves: [save(RELEASE, null), save(HOLDING, null), save(KEEP, null)],
    note: "They say the app is already gone from where it was published, so nothing is published or held now.",
  }),
});
