import { defineCheck, fail } from "@corbits-builder/plugin";

// The tests that load this fixture give removable:hoster as a fact; the check itself never passes.
export default defineCheck({
  describe: {
    summary:
      "Confirms the person agreed to take down what Hoster published or holds now.",
    when: "Before hoster remove.",
    failed: "The person has not agreed to take down what Hoster holds now.",
  },
  run: async () =>
    fail("The person has not agreed to take down what Hoster holds now"),
});
