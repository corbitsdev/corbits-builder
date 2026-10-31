import type { InputKind, Ref } from "./config.ts";
import { Refusal } from "./refusal.ts";

export const refsOf = (byKind: Map<string, Ref>) =>
  [...byKind].map(([kind, ref]) => ({ kind, ...ref }));

export const required = (byKind: Map<string, Ref>, kind: string) => {
  const ref = byKind.get(kind);
  if (!ref)
    throw new Refusal(
      kind +
        "_not_filed: " +
        (kind === "design"
          ? "have the designer make it with design_app first"
          : "write and file the " + kind + " first"),
    );
  return ref;
};

// A fresh deployment warms its workspace with the current versions, the ones named here.
export const inputs = (kinds: readonly InputKind[], byKind: Map<string, Ref>) =>
  kinds.map((kind) => ({
    kind,
    version: required(byKind, kind).version,
  }));
