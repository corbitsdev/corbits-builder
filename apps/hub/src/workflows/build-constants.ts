// The values build-packages.ts writes into each workflow package with Bun.build's define, which
// replaces the exact expression `process.env.<name>`. agent-package.ts and role-inference.ts must
// spell that expression out for the replacement to happen, so they name these again by hand.
export const BUILD_CONSTANTS = [
  "BUILDER_AGENT",
  "BUILDER_BROWSER",
  "BUILDER_ROLE_INFERENCE",
  "BUILDER_TOOLS",
] as const;

/** The define key that replaces `name` in a workflow package. */
export const defineKey = (name: (typeof BUILD_CONSTANTS)[number]) =>
  `process.env.${name}` as const;
