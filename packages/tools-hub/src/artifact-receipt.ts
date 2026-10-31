import { ArtifactReceipt } from "@corbits-builder/schemas/artifact";

// A deployed agent keeps the tool bundle it started with while the hub moves on; a field a newer
// hub adds must not fail every write of an older agent.
export const HubArtifactReceipt = ArtifactReceipt.onDeepUndeclaredKey("ignore");
