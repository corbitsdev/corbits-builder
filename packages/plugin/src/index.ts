import { type } from "arktype";
import { Tier } from "@corbits-builder/schemas/models";

// What a person reads of a model setting in Settings, and the tier of their profile it runs on.
export const ModelSetting = type({
  "+": "reject",
  label: "string > 0",
  hint: "string > 0",
  tier: Tier,
});
export type ModelSetting = typeof ModelSetting.infer;

// model names the model setting a role runs on, and limits the output budget it runs with.
export const Role = type({
  "+": "reject",
  name: "string > 0",
  model: "string > 0",
  limits: "string > 0",
});
export type Role = typeof Role.infer;

// A package's entry is the module whose default export is its workflow and whose named exports are
// its directors.
export const Builder = type({
  "+": "reject",
  roles: Role.array().atLeastLength(1),
  "settings?": { "[string]": ModelSetting },
  packages: { "[string]": { "+": "reject", entry: "string > 0" } },
});
export type Builder = typeof Builder.infer;
