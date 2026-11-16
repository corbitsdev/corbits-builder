import { type } from "arktype";
import { WriterDocumentKind } from "@corbits-builder/schemas/artifact";
import { Tier } from "@corbits-builder/schemas/models";

// What a person reads of a model setting in Settings, and the tier of their profile it runs on.
export const ModelSetting = type({
  "+": "reject",
  label: "string > 0",
  hint: "string > 0",
  tier: Tier,
});
export type ModelSetting = typeof ModelSetting.infer;

// model names the model setting a role runs on, and limits the output budget it runs with. called
// is how the person's status lines name a run of it, as "the designer". A role a coordinator
// assigns work to says, in ended, what the person reads when a run of it failed or was stopped, and
// how its coordinator is told which task stopped; {kind} there is the document kind it was given.
export const Role = type({
  "+": "reject",
  name: "string > 0",
  model: "string > 0",
  limits: "string > 0",
  called: "string > 0",
  "ended?": {
    "+": "reject",
    failed: "string > 0",
    cancelled: "string > 0",
    task: "string > 0",
  },
});
export type Role = typeof Role.infer;

// A package's entry is the module whose default export is its workflow and whose named exports are
// its directors; role is the plugin's role its runs play. files is the one document kind a writer
// package saves. A package that replaces another is the one a project's runs deploy under that
// name, always or while the project's yes-or-no preference named by when is yes.
export const WorkflowPackage = type({
  "+": "reject",
  entry: "string > 0",
  role: "string > 0",
  "files?": WriterDocumentKind,
  "replaces?": { "+": "reject", package: "string > 0", "when?": "string > 0" },
});
export type WorkflowPackage = typeof WorkflowPackage.infer;

export const Builder = type({
  "+": "reject",
  roles: Role.array().atLeastLength(1),
  "settings?": { "[string]": ModelSetting },
  packages: { "[string]": WorkflowPackage },
});
export type Builder = typeof Builder.infer;
