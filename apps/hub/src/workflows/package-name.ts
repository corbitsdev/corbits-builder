// The npm name each role's workflow package publishes under. A director the package ships is named
// under it, since Interchange resolves a director id by its package-name prefix.
export const nativePackageName = (role: string) =>
  `@corbits-builder/${role}-native`;
