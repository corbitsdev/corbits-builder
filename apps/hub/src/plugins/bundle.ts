import { catalog } from "./catalog.ts";

// Bundles run from the package store on sidecars, where the hub's plugin folders do not exist.
export function writerPackages(): Record<string, string> {
  return Object.fromEntries(catalog.filers);
}
