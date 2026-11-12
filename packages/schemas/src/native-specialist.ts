import { type } from "arktype";

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

// What a specialist's assignment may say it is to do.
export const SpecialistInstruction = type("string > 0").atMostLength(16384);
