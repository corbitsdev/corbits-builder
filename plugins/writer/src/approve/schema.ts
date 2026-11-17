import { type } from "arktype";
import { DocumentKind } from "@corbits-builder/schemas/artifact";

export const Input = type({
  "+": "reject",
  kinds: DocumentKind.array().atLeastLength(1),
});

// Each document the person approved, at the version they were shown.
export const Output = type({
  "+": "reject",
  approved: type({
    "+": "reject",
    kind: DocumentKind,
    artifactId: "string > 0",
    version: "number.integer > 0",
  })
    .array()
    .atLeastLength(1),
});
