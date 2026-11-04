import type { WriterDocumentKind } from "@corbits-builder/schemas/artifact";

// The npm name each role's workflow package publishes under. A director the package ships is named
// under it, since Interchange resolves a director id by its package-name prefix.
export const nativePackageName = (role: string) =>
  `@corbits-builder/${role}-native`;

// Each writer package saves one document kind; entries/ holds one entry per name.
export const WRITER_PACKAGES = {
  constraints: "writer-constraints",
  approaches: "writer-approaches",
  product_requirements: "writer-product-requirements",
  build_plan: "writer-build-plan",
} as const satisfies Record<WriterDocumentKind, string>;
