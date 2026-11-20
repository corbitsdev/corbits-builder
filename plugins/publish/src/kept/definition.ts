import { defineTask } from "@corbits-builder/plugin";
import { PUBLISH_KEEP } from "@corbits-builder/publish-contract";
import { type } from "arktype";

// The person kept the app at its place, so the link to keep it has done its work.
export default defineTask({
  says: "The person kept the app published without an account.",
  input: type({ "+": "reject" }),
  describe: { fields: {} },
  writes: [PUBLISH_KEEP],
  run: () => ({ saves: [{ name: PUBLISH_KEEP, value: null }] }),
});
