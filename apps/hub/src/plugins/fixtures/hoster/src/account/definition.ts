import { defineScreen } from "@corbits-builder/plugin";
import { type } from "arktype";

export default defineScreen({
  input: type({ "+": "reject" }),
  output: type({
    "+": "reject",
    choice: { "+": "reject", size: "string > 0", region: "string > 0" },
  }),
  // The form needs nothing prepared, but a screen with nothing prepared is not shown.
  prepare: () => ({}),
  describe: {
    says: { label: () => "Hoster account" },
    summary:
      "Has the person sign in to Hoster and choose the machine to rent. The answer is { choice: { size, region } }.",
    when: "The person is not signed in to Hoster yet.",
    unless: "They are.",
    fields: {},
  },
  writes: {
    "hoster.choice": ({ choice }) => choice,
    "hoster.region": ({ choice }) => choice.region,
  },
});
