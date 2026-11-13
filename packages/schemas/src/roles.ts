import { type } from "arktype";

// The name of the role a run plays: the coordinator's, or one an installed plugin declares. Which
// names there are is the hub's plugin registry's to say, so the wire carries the name alone.
export const RoleName = type("string > 0");
export type RoleName = typeof RoleName.infer;
