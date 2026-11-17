import { defineScreen } from "@corbits-builder/plugin";
import { type } from "arktype";

export default defineScreen({
  input: type({ "+": "reject" }),
  output: type({ "+": "reject", saved: "true" }),
  // The form needs nothing prepared, but a screen with nothing prepared is not shown.
  prepare: () => ({}),
  describe: {
    says: { label: () => "Keyholder API key" },
    summary:
      "Asks the person for their Keyholder API key and saves it. The answer is { saved: true }.",
    when: "The Keyholder API key is not saved yet.",
    unless: "It is saved.",
    fields: {},
  },
});
