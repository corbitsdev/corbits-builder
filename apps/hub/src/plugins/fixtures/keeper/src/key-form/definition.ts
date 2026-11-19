import { defineScreen } from "@corbits-builder/plugin";
import { type } from "arktype";

export default defineScreen({
  input: type({ "+": "reject" }),
  output: type({ "+": "reject", saved: "true" }),
  // The form needs nothing prepared, but a screen with nothing prepared is not shown.
  prepare: () => ({}),
  describe: {
    says: { label: () => "Keeper API key" },
    summary:
      "Asks the person for their Keeper API key and saves it. The answer is { saved: true }.",
    when: "The Keeper API key is not saved yet.",
    unless: "It is saved.",
    fields: {},
  },
});
