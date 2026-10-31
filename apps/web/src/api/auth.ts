/**
 * Hub identity: better-auth on the hub's own origin, through the four
 * endpoints the hub composes (`get-session`, `sign-in/email`,
 * `sign-up/email`, `sign-out`), all with the session cookie included.
 */
import type { Workspace } from "@corbits-builder/client";
import { productName, wording } from "../config.ts";
import { hubCredentials, hubOrigin } from "./origin.ts";
import { productClient, timedCall } from "./transport.ts";
import {
  readStoredPreference,
  writeStoredPreference,
} from "../stored-preference.ts";

export type HubUser = {
  id: string;
  name: string;
  email: string;
};

export type HubSession = { user: HubUser } | null;

type AuthJson = {
  user?: { id?: unknown; name?: unknown; email?: unknown } | null;
  message?: unknown;
  error?: { code?: unknown; message?: unknown };
};

async function hubAuth(
  path: string,
  init: RequestInit,
): Promise<{ response: Response; parsed: unknown }> {
  let response: Response;
  try {
    response = await fetch(`${hubOrigin()}/api/auth${path}`, {
      ...init,
      credentials: hubCredentials(),
    });
  } catch {
    throw new Error(wording.auth.hubUnreachable);
  }
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text.length === 0 ? undefined : JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  return { response, parsed };
}

function messageOf(parsed: unknown, fallback: string): string {
  const body = parsed as AuthJson | undefined;
  if (typeof body?.message === "string" && body.message.length > 0)
    return body.message;
  if (typeof body?.error?.message === "string" && body.error.message.length > 0)
    return body.error.message;
  return fallback;
}

function userOf(parsed: unknown): HubUser | null {
  const user = (parsed as AuthJson | undefined)?.user;
  if (!user || typeof user.id !== "string" || typeof user.email !== "string")
    return null;
  return {
    id: user.id,
    name:
      typeof user.name === "string" && user.name.trim().length > 0
        ? user.name
        : user.email,
    email: user.email,
  };
}

export async function getHubSession(): Promise<HubSession> {
  const { response, parsed } = await hubAuth("/get-session", { method: "GET" });
  if (response.status === 401) return null;
  if (!response.ok) {
    throw new Error(messageOf(parsed, `HTTP ${String(response.status)}`));
  }
  const user = userOf(parsed);
  return user ? { user } : null;
}

async function emailAuth(
  path: "/sign-in/email" | "/sign-up/email",
  body: Record<string, string>,
  copy: { failed: string; noUser: string },
): Promise<HubUser> {
  const { response, parsed } = await hubAuth(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(messageOf(parsed, copy.failed));
  }
  const user = userOf(parsed);
  if (!user) throw new Error(copy.noUser);
  cachedTenantId = undefined;
  return user;
}

export function signInHub(input: {
  email: string;
  password: string;
}): Promise<HubUser> {
  return emailAuth("/sign-in/email", input, wording.auth.signIn);
}

export function signUpHub({
  name,
  ...input
}: {
  name?: string;
  email: string;
  password: string;
}): Promise<HubUser> {
  return emailAuth(
    "/sign-up/email",
    {
      ...input,
      name: name?.trim() || (input.email.split("@")[0] ?? input.email),
    },
    wording.auth.signUp,
  );
}

export async function signOutHub(): Promise<void> {
  const { response, parsed } = await hubAuth("/sign-out", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!response.ok && response.status !== 401) {
    throw new Error(messageOf(parsed, wording.auth.signOutFailed));
  }
  cachedTenantId = undefined;
}

class NoWorkspaceError extends Error {}

/** A workspace: one root tenant the person belongs to, with its own projects and credentials. */
export type { Workspace };

/** Which workspace this browser last chose; the hub's memberships decide whether it still holds. */
const WORKSPACE_KEY = "builder-workspace";

let cachedTenantId: string | undefined;

/** The person's workspaces under the install root, oldest first, read from their memberships. */
export async function listWorkspaces(): Promise<Workspace[]> {
  return (await timedCall((signal) => productClient().workspaces(signal))).data;
}

/**
 * The open workspace's tenant id, cached for the session: the one this browser chose while the
 * person still belongs to it, else their first. Every other module in this directory scopes its
 * calls with it.
 */
export async function workspaceTenantId(): Promise<string> {
  if (cachedTenantId) return cachedTenantId;
  const workspaces = await listWorkspaces();
  const chosen = readStoredPreference(WORKSPACE_KEY);
  const open =
    workspaces.find((workspace) => workspace.id === chosen) ?? workspaces[0];
  if (!open) throw new NoWorkspaceError(wording.auth.noWorkspace);
  return (cachedTenantId = open.id);
}

/** Makes `tenantId` the open workspace; every later read scopes itself with it. */
export function openWorkspace(tenantId: string): void {
  writeStoredPreference(WORKSPACE_KEY, tenantId);
  cachedTenantId = tenantId;
}

/** A new workspace under the install root; the hub picks its slug and makes the person its owner. */
export async function createWorkspace(name: string): Promise<Workspace> {
  const created = await timedCall((signal) =>
    productClient().createWorkspace({ name }, signal),
  );
  return { id: created.id, name };
}

/**
 * Makes sure the signed-in person holds a workspace tenant: on a fresh hub
 * the first sign-in creates it, later sessions only resolve it. Without this
 * every fold read fails with "not a member of any workspace" and the shell
 * reads as if the hub were down.
 */
export async function ensureWorkspace(): Promise<string> {
  try {
    return await workspaceTenantId();
  } catch (error) {
    if (!(error instanceof NoWorkspaceError)) throw error;
    openWorkspace((await createWorkspace(productName)).id);
    return workspaceTenantId();
  }
}
