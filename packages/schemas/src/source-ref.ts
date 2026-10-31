import { type } from "arktype";

export const SourceRef = type({
  "+": "reject",
  artifactId: "string > 0",
  version: "number.integer > 0",
  sha256: /^[a-f0-9]{64}$/,
  "locator?": "string > 0",
});
