import { reader } from "@corbits-builder/environment";
import { type } from "arktype";

/**
 * A workflow child's environment, as Interchange's sidecar starts it: the sidecar's signing key.
 * The child signs a run's conversation commits with it (workflow-host substrate-factory.ts
 * createStepStorageSigner), and the coder's tools sign its app commits with it. Interchange sets
 * and checks these; Builder only reads them, and only where it signs.
 */
export const readWorkflowChildEnvironment = reader(
  type({
    "+": "delete",
    "SIDECAR_SIGNING_PUBLIC_KEY?": "string",
    "SIDECAR_SIGNING_PRIVATE_KEY?": "string",
  }),
);
