import { defineTask, save } from "@corbits-builder/plugin";
import { KEEP } from "@corbits-builder/publishing";
import { type } from "arktype";

export default defineTask({
  says: "The person kept the app in their own account.",
  input: type({ "+": "reject" }),
  writes: [KEEP],
  describe: {
    fields: {},
  },
  run: () => ({
    saves: [save(KEEP, null)],
    note: "They kept the app in their own account, so it is theirs and the next publish updates it there.",
  }),
});
