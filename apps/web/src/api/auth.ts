/**
 * Hub identity: better-auth on the hub's own origin, through the four
 * endpoints the hub composes (`get-session`, `sign-in/email`,
 * `sign-up/email`, `sign-out`), all with the session cookie included.
 */
import type { Workspace } from "@corbits-builder/client";
import { type } from "arktype";
import { productName, wording } from "../config.ts";
import { hubCredentials, hubOrigin } from "./origin.ts";
import { productClient } from "./transport.ts";
import { ApiFailure } from "./types.ts";
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

// better-auth answers with `message` or `error.message` on a refusal, and `user` on a session.
const AuthMessage = type({ message: "string > 0" });
const AuthErrorMessage = type({ error: { message: "string > 0" } });
const AuthSession = type({
  user: { id: "string", email: "string", "name?": "unknown" },
});

async function hubAuth(
  path: string,
  init: RequestInit,
): Promise<{ response: Response; parsed: unknown }> {
  let response: Response;
  let text: string;
  try {
    response = await fetch(`${hubOrigin()}/api/auth${path}`, {
      ...init,
      credentials: hubCredentials(),
    });
    text = await response.text();
  } catch (cause) {
    throw new ApiFailure(
      {
        code: "host_unreachable",
        message: wording.auth.hubUnreachable,
        correlationId: "-",
        retryable: true,
      },
      undefined,
      { cause },
    );
  }
  let parsed: unknown;
  try {
    parsed = text.length === 0 ? undefined : JSON.parse(text);
  } catch (cause) {
    // A proxy in front of the hub can answer with a page instead of JSON.
    if (!(cause instanceof SyntaxError)) throw cause;
    parsed = undefined;
  }
  return { response, parsed };
}

function messageOf(parsed: unknown, fallback: string): string {
  const body = AuthMessage(parsed);
  if (!(body instanceof type.errors)) return body.message;
  const nested = AuthErrorMessage(parsed);
  return nested instanceof type.errors ? fallback : nested.error.message;
}

function userOf(parsed: unknown): HubUser | null {
  const session = AuthSession(parsed);
  if (session instanceof type.errors) return null;
  const { id, email, name } = session.user;
  return {
    id,
    name: typeof name === "string" && name.trim().length > 0 ? name : email,
    email,
  };
}

export async function getHubSession(): Promise<HubSession> {
  const { response, parsed } = await hubAuth("/get-session", { method: "GET" });
  if (response.status === 401) return null;
  if (!response.ok) {
    throw new ApiFailure(
      {
        code: "session_unreadable",
        message: messageOf(parsed, `HTTP ${String(response.status)}`),
        correlationId: "-",
        retryable: response.status >= 500,
      },
      response.status,
    );
  }
  // better-auth answers a request with no session with a JSON null.
  if (parsed === null) return null;
  const user = userOf(parsed);
  if (user === null)
    throw new ApiFailure(
      {
        code: "session_unreadable",
        message: wording.auth.accountUnreadable,
        correlationId: "-",
        retryable: false,
      },
      response.status,
    );
  return { user };
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
  return (await productClient().workspaces()).data;
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
  const created = await productClient().createWorkspace({ name });
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
