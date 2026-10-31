import { canonicalJsonStringify } from "@intx/types/wire-definition-hash";

export const digest = (value: unknown) =>
  new Bun.CryptoHasher("sha256")
    .update(canonicalJsonStringify(value))
    .digest("hex");
