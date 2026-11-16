import { type } from "arktype";
import { WriterDocumentKind } from "@corbits-builder/schemas/artifact";
import { Tier } from "@corbits-builder/schemas/models";

export const ModelSetting = type({
  "+": "reject",
  label: "string > 0",
  hint: "string > 0",
  tier: Tier,
});
export type ModelSetting = typeof ModelSetting.infer;

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

export const WorkflowPackage = type({
  "+": "reject",
  entry: "string > 0",
  role: "string > 0",
  "files?": WriterDocumentKind,
  "legacyAlias?": "'writer'",
  "replaces?": { "+": "reject", package: "string > 0", when: "string > 0" },
});
export type WorkflowPackage = typeof WorkflowPackage.infer;

export const Builder = type({
  "+": "reject",
  roles: Role.array().atLeastLength(1),
  "settings?": { "[string]": ModelSetting },
  packages: { "[string]": WorkflowPackage },
});
export type Builder = typeof Builder.infer;
