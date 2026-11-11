import { type } from "arktype";

const name = /^[a-z][a-z_]{0,63}$/;

// Preference id to chosen option id. The hub's registry decides which ids and options exist.
export const Preferences = type({ "[string]": name }).narrow(
  (choices, ctx) =>
    (Object.keys(choices).length <= 50 &&
      Object.keys(choices).every((id) => name.test(id))) ||
    ctx.mustBe("at most 50 preference choices keyed by preference id"),
);
export type Preferences = typeof Preferences.infer;

export const PreferenceGroup = type(
  "'conversation' | 'reviews' | 'building' | 'approvals'",
);
export type PreferenceGroup = typeof PreferenceGroup.infer;

const PreferenceDefinition = type({
  "+": "reject",
  id: name,
  label: "string > 0",
  "hint?": "string > 0",
  group: PreferenceGroup,
  options: type({ "+": "reject", id: name, label: "string > 0" })
    .array()
    .atLeastLength(2),
  // Present when the options are ordered: they are shown as a scale between these two words.
  "ends?": type({ "+": "reject", start: "string > 0", end: "string > 0" }),
  default: name,
});

export const PreferenceRegistry = type({
  "+": "reject",
  preferences: PreferenceDefinition.array(),
});
export type PreferenceRegistry = typeof PreferenceRegistry.infer;
