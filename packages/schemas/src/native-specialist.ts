import { type } from "arktype";
import { SourceRef } from "./source-ref.ts";
import { ProjectId } from "./project.ts";

export const NativeDocumentKind = type(
  "'constraints' | 'approaches' | 'product_requirements' | 'build_plan' | 'engineering_review'",
);
export type NativeDocumentKind = typeof NativeDocumentKind.infer;
export const SPECIALIST_RESULT_TYPE = "sb.specialist.result";

// Source identity is resolved at project bootstrap, never composed per assignment.
export const NativeSpecialistDeployment = type({
  "+": "reject",
  source: {
    "+": "reject",
    kind: "'asset'",
    assetId: "string > 0",
    package: { "+": "reject", format: "'tarball'" },
  },
  entry: "string > 0",
  pin: /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
  sourceOfferingIds: type("string > 0").array().atLeastLength(1),
  defaultSourceOfferingId: "string > 0",
});
export type NativeSpecialistDeployment =
  typeof NativeSpecialistDeployment.infer;

export const NativeSpecialistAssignment = type({
  "+": "reject",
  projectId: ProjectId,
  deliverableId: ProjectId,
  kind: NativeDocumentKind,
  briefRef: SourceRef,
  sourceRefs: SourceRef.array(),
  output: { "+": "reject", expectedVersion: "number.integer >= 0" },
  instruction: type("string > 0").atMostLength(16384),
});
export type NativeSpecialistAssignment =
  typeof NativeSpecialistAssignment.infer;
