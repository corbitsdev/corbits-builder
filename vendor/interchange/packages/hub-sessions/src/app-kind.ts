// KindHandler for the `app` asset kind.
//
// An app asset is the source of an application a builder writes: arbitrary
// files, text or binary. The push refuses installs, build output, and
// environment files anywhere in the tree, so a clone never carries
// dependencies the app restores itself, artefacts it rebuilds, or secrets.
//
// Authz:
//   - hub principal: full access.
//   - sidecar principal: read-only (createPack, resolveRef).
//   - user principal: gated by bearer-token claims and the route
//     layer's pre-resolved authz verdict, mirroring the convention
//     used by skill assets.

import { type } from "arktype";
import { getLogger } from "@intx/log";
import {
  authorizeUserPrincipal,
  type AuthorizeFn,
  type CommittedTreeEntry,
  type KindHandler,
  type Principal,
  type ValidatePushResult,
} from "./repo-store";

const logger = getLogger(["hub-sessions", "app-kind"]);

export const APP_EXCLUDED_DIRECTORIES: readonly string[] = [
  "node_modules",
  "dist",
];

// Names compare case-insensitively: on a case-insensitive filesystem
// `Node_Modules/` or `.ENV` is the same entry a checkout would create.
export const isAppExcludedDirectory = (name: string): boolean =>
  APP_EXCLUDED_DIRECTORIES.includes(name.toLowerCase());

export const isAppEnvironmentFile = (name: string): boolean =>
  name.toLowerCase().startsWith(".env");

const SidecarPrincipal = type({
  kind: "'sidecar'",
  agentId: "string",
});

async function findExcluded(
  listDirOids: (path: string) => Promise<CommittedTreeEntry[]>,
  dir: string,
): Promise<string | null> {
  for (const entry of await listDirOids(dir)) {
    const path = dir === "" ? entry.name : `${dir}/${entry.name}`;
    if (entry.type === "tree") {
      if (isAppExcludedDirectory(entry.name)) return `${path}/`;
      const nested = await findExcluded(listDirOids, path);
      if (nested !== null) return nested;
    } else if (isAppEnvironmentFile(entry.name)) {
      return path;
    }
  }
  return null;
}

export const appKindHandler: KindHandler = {
  kind: "app",
  directoryPrefix: "assets/app",
  async validatePush({
    repoId,
    ref,
    listDirOids,
  }): Promise<ValidatePushResult> {
    const excluded = await findExcluded(listDirOids, "");
    if (excluded === null) return { ok: true };
    const reason = `${excluded} is not allowed in an app asset: installs, build output and environment files stay out of the repository`;
    logger.debug`app validatePush rejected ${repoId.kind}/${repoId.id} on ${ref}: ${reason}`;
    return { ok: false, reason };
  },
  onRefUpdated() {
    // No cached index. Consumers read the app tree through the substrate.
  },
};

export const appAuthorize: AuthorizeFn = (
  principal: Principal,
  repoId,
  ref,
  action,
) => {
  if (repoId.kind !== "app") {
    return {
      allowed: false,
      reason: `app authorize received non-app repo ${repoId.kind}/${repoId.id}`,
    };
  }

  if (principal.kind === "hub") {
    return { allowed: true };
  }

  if (principal.kind === "sidecar") {
    const parsed = SidecarPrincipal(principal);
    if (parsed instanceof type.errors) {
      return {
        allowed: false,
        reason: `sidecar principal is malformed: ${parsed.summary}`,
      };
    }
    switch (action) {
      case "createPack":
      case "resolveRef":
        return { allowed: true };
      case "init":
      case "writeTree":
      case "receivePack":
        return {
          allowed: false,
          reason: `sidecars may only read app assets, not ${action}`,
        };
      default: {
        const _exhaustive: never = action;
        return {
          allowed: false,
          reason: `unhandled action: ${String(_exhaustive)}`,
        };
      }
    }
  }

  if (principal.kind === "user") {
    return authorizeUserPrincipal({
      principal,
      repoId,
      ref,
      action,
      resourcePrefix: "asset",
    });
  }

  return {
    allowed: false,
    reason: `unknown principal kind: ${principal.kind}`,
  };
};
