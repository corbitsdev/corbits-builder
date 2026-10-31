import { readBaseURL, required, type Environment } from "./environment.ts";

export type BootstrapOptions = {
  baseURL: string;
  email: string;
  password: string;
  name: string;
  tenantSlug: string;
  tenantName: string;
};

export type BootstrapTransport = (
  url: URL,
  init?: RequestInit,
) => Promise<Response>;

type PrincipalSummary = {
  principalId: string;
  tenantId: string;
  tenantSlug: string;
  status: string;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readBootstrapOptions(env: Environment): BootstrapOptions {
  return {
    baseURL: readBaseURL(env),
    email: required(env, "BOOTSTRAP_EMAIL"),
    password: required(env, "BOOTSTRAP_PASSWORD"),
    name: env["BOOTSTRAP_NAME"] ?? required(env, "BOOTSTRAP_EMAIL"),
    tenantSlug: required(env, "BOOTSTRAP_TENANT_SLUG"),
    tenantName:
      env["BOOTSTRAP_TENANT_NAME"] ?? required(env, "BOOTSTRAP_TENANT_SLUG"),
  };
}

function endpoint(baseURL: string, path: string): URL {
  const base = new URL(baseURL);
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password
  ) {
    throw new Error("Invalid bootstrap base URL");
  }
  return new URL(path, base);
}

function sessionCookie(response: Response): string {
  const cookies = response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";", 1)[0])
    .filter((cookie): cookie is string => Boolean(cookie));
  if (cookies.length === 0)
    throw new Error("Authentication did not establish a session");
  return cookies.join("; ");
}

async function post(
  options: BootstrapOptions,
  path: string,
  body: unknown,
  cookie?: string,
  transport: BootstrapTransport = fetch,
): Promise<Response> {
  const url = endpoint(options.baseURL, path);
  return transport(url, {
    method: "POST",
    redirect: "error",
    headers: {
      "Content-Type": "application/json",
      Origin: url.origin,
      ...(cookie === undefined ? {} : { Cookie: cookie }),
    },
    body: JSON.stringify(body),
  });
}

// The stock signed session cookie belongs to this dedicated API account only;
// it is held by the caller and never written as bootstrap output.
async function authenticateBootstrap(
  options: BootstrapOptions,
  transport: BootstrapTransport = fetch,
): Promise<string> {
  let response = await post(
    options,
    "/api/auth/sign-in/email",
    {
      email: options.email,
      password: options.password,
    },
    undefined,
    transport,
  );
  if (response.status === 401) {
    await response.body?.cancel();
    response = await post(
      options,
      "/api/auth/sign-up/email",
      {
        email: options.email,
        password: options.password,
        name: options.name,
      },
      undefined,
      transport,
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("Bootstrap authentication failed");
  }
  const cookie = sessionCookie(response);
  await response.body?.cancel();
  return cookie;
}

function principalSummary(value: unknown): value is PrincipalSummary {
  return (
    record(value) &&
    typeof value["principalId"] === "string" &&
    typeof value["tenantId"] === "string" &&
    typeof value["tenantSlug"] === "string" &&
    typeof value["status"] === "string"
  );
}

async function findPrincipal(
  options: BootstrapOptions,
  cookie: string,
  transport: BootstrapTransport,
): Promise<PrincipalSummary | undefined> {
  let cursor: string | undefined;
  do {
    const url = endpoint(options.baseURL, "/api/me/principals");
    if (cursor !== undefined) url.searchParams.set("cursor", cursor);
    const response = await transport(url, {
      redirect: "error",
      headers: { Cookie: cookie },
    });
    if (!response.ok) throw new Error("Principal lookup failed");
    const page: unknown = await response.json();
    if (!record(page) || !Array.isArray(page["data"]))
      throw new Error("Invalid principal lookup response");
    for (const item of page["data"]) {
      if (!principalSummary(item)) throw new Error("Invalid principal summary");
      if (item.tenantSlug === options.tenantSlug) return item;
    }
    const next = page["nextCursor"];
    if (next !== null && next !== undefined && typeof next !== "string")
      throw new Error("Invalid principal cursor");
    cursor = typeof next === "string" ? next : undefined;
  } while (cursor !== undefined);
  return undefined;
}

async function bootstrapAuthenticated(
  options: BootstrapOptions,
  cookie: string,
  transport: BootstrapTransport,
) {
  let principal = await findPrincipal(options, cookie, transport);
  if (principal === undefined) {
    const response = await post(
      options,
      "/api/tenants",
      { name: options.tenantName, slug: options.tenantSlug },
      cookie,
      transport,
    );
    if (response.status !== 201) {
      await response.body?.cancel();
      throw new Error("Tenant bootstrap failed");
    }
    await response.body?.cancel();
    principal = await findPrincipal(options, cookie, transport);
  }
  if (principal === undefined || principal.status !== "active")
    throw new Error("Bootstrap principal is not active");
  const hello = await transport(
    endpoint(
      options.baseURL,
      `/api/tenants/${encodeURIComponent(principal.tenantId)}/product/hello`,
    ),
    {
      redirect: "error",
      headers: { Cookie: cookie },
    },
  );
  if (!hello.ok) throw new Error("Authenticated hello failed");
  const body: unknown = await hello.json();
  if (
    !record(body) ||
    body["principalId"] !== principal.principalId ||
    body["tenantId"] !== principal.tenantId ||
    body["authenticated"] !== true
  ) {
    throw new Error("Hello did not confirm the bootstrap principal");
  }
  return {
    authenticated: true,
    principalReady: true,
    hello: true,
    tenantId: principal.tenantId,
    principalId: principal.principalId,
  };
}

async function endBootstrapSession(
  options: BootstrapOptions,
  cookie: string,
  transport: BootstrapTransport,
) {
  const response = await post(
    options,
    "/api/auth/sign-out",
    {},
    cookie,
    transport,
  );
  await response.body?.cancel();
  if (!response.ok) throw new Error("Bootstrap session cleanup failed");
}

export async function bootstrapPrincipal(
  options: BootstrapOptions,
  transport: BootstrapTransport = fetch,
) {
  const cookie = await authenticateBootstrap(options, transport);
  try {
    return await bootstrapAuthenticated(options, cookie, transport);
  } finally {
    // Setup needs a session only for this pass. Leaving one per retry would
    // make setup non-idempotent and accumulate unused bearer authority.
    await endBootstrapSession(options, cookie, transport);
  }
}
