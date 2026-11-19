import { createHash } from "node:crypto";
import { type, type Type } from "arktype";
import { PRIVACY_POLICY, TERMS_OF_SERVICE } from "./target.ts";

export const API = "https://api.cloudflare.com/client/v4";

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * How calls reach Cloudflare's API. With the person's saved key, `fetch` adds the key. With a
 * temporary account, `token` is kept in memory for one release and added here. `plain` adds no
 * credentials; the asset upload uses it to send an upload session's token instead.
 */
export type Client = {
  fetch: Fetch;
  plain: Fetch;
  token?: string;
  signal: AbortSignal;
  // Whether to retry a refused call; it waits before it returns true. A refused request changed
  // nothing, so retrying it is safe. Without `again`, a refusal is final.
  again?: (refusal: CloudflareRefused) => Promise<boolean>;
};

/**
 * Cloudflare refused the call. It keeps the HTTP status and numeric error codes but not the
 * messages, because Cloudflare may change their wording and no model should read them.
 */
export class CloudflareRefused extends Error {
  constructor(
    readonly status: number,
    readonly codes: readonly number[],
  ) {
    super("cloudflare_refused");
    this.name = "CloudflareRefused";
  }
}

/** Cloudflare could not be reached, failed, or answered in a shape this code does not know. */
export class CloudflareUnavailable extends Error {
  constructor(options?: ErrorOptions) {
    super("cloudflare_unavailable", options);
    this.name = "CloudflareUnavailable";
  }
}

const Envelope = type({
  success: "boolean",
  "errors?": type({ code: "number" }).array().or("null"),
  "result?": "unknown",
});

const MAX_ANSWER_BYTES = 4 * 1024 * 1024;

type Method = "GET" | "POST" | "PUT" | "DELETE";

async function call<T>(
  client: Client,
  method: Method,
  path: string,
  shape: Type<T>,
  body?: object | FormData,
  token = client.token,
): Promise<T> {
  for (;;) {
    try {
      return await callOnce(client, method, path, shape, body, token);
    } catch (error) {
      if (
        !(error instanceof CloudflareRefused) ||
        client.again === undefined ||
        !(await client.again(error))
      )
        throw error;
    }
  }
}

async function callOnce<T>(
  client: Client,
  method: Method,
  path: string,
  shape: Type<T>,
  body: object | FormData | undefined,
  token: string | undefined,
): Promise<T> {
  const headers = new Headers();
  if (token !== undefined) headers.set("authorization", `Bearer ${token}`);
  let sent: string | FormData | undefined;
  if (body instanceof FormData) sent = body;
  else if (body !== undefined) {
    headers.set("content-type", "application/json");
    sent = JSON.stringify(body);
  }
  let response: Response;
  let answer: unknown;
  try {
    response = await client.fetch(`${API}${path}`, {
      method,
      headers,
      ...(sent === undefined ? {} : { body: sent }),
      redirect: "manual",
      signal: AbortSignal.any([client.signal, AbortSignal.timeout(120_000)]),
    });
    const text = await response.text();
    if (text.length > MAX_ANSWER_BYTES) throw new Error("answer_too_large");
    answer = JSON.parse(text);
  } catch (error) {
    if (client.signal.aborted) throw error;
    throw new CloudflareUnavailable({ cause: error });
  }
  const envelope = Envelope(answer);
  if (envelope instanceof type.errors) {
    if (response.status >= 400 && response.status < 500)
      throw new CloudflareRefused(response.status, []);
    throw new CloudflareUnavailable();
  }
  if (!response.ok || !envelope.success) {
    if (response.status >= 500) throw new CloudflareUnavailable();
    throw new CloudflareRefused(
      response.status,
      (envelope.errors ?? []).map(({ code }) => code),
    );
  }
  const result = shape(envelope.result);
  if (result instanceof type.errors) throw new CloudflareUnavailable();
  return result as T;
}

const segment = (value: string) => encodeURIComponent(value);
const scripts = (account: string, script: string) =>
  `/accounts/${segment(account)}/workers/scripts/${segment(script)}`;

const Challenge = type({
  challengeToken: "string > 0",
  seed: "string > 0",
  k: "number",
  g: "number",
  "+": "ignore",
});
export type Challenge = typeof Challenge.infer;

export const requestChallenge = (client: Client) =>
  call(client, "POST", "/provisioning/previews/challenge", Challenge, {});

const Temporary = type({
  account: { id: "string > 0", apiToken: "string > 0", "+": "ignore" },
  claim: { url: "string > 0", expiresAt: "string > 0", "+": "ignore" },
  "+": "ignore",
});
export type Temporary = typeof Temporary.infer;

/** Creates a temporary account; called only once the person has accepted both documents. */
export const createTemporaryAccount = (
  client: Client,
  challengeToken: string,
  checkpoints: string,
) =>
  call(client, "POST", "/provisioning/previews", Temporary, {
    termsOfService: TERMS_OF_SERVICE,
    privacyPolicy: PRIVACY_POLICY,
    acceptTermsOfService: "yes",
    challengeToken,
    solution: { checkpoints },
  });

const Accounts = type({ id: "string > 0", "+": "ignore" }).array();
export const listAccounts = async (client: Client) =>
  (await call(client, "GET", "/accounts?per_page=50", Accounts)).map(
    ({ id }) => id,
  );

const Verified = type({ status: "string", "+": "ignore" });

/**
 * Whether the saved key is active. A key made under the person's profile verifies at
 * /user/tokens/verify. A key made under the account (Manage account > Account API tokens) gets 401
 * there and verifies at the account's route, so that route is tried when the first refuses. Both
 * routes also answer for an expired or disabled key, with that status, so only "active" counts.
 * https://developers.cloudflare.com/api/resources/accounts/subresources/tokens/methods/verify/
 */
export async function keyActive(client: Client, account: string) {
  try {
    return (
      (await call(client, "GET", "/user/tokens/verify", Verified)).status ===
      "active"
    );
  } catch (error) {
    if (!(error instanceof CloudflareRefused)) throw error;
  }
  return (
    (
      await call(
        client,
        "GET",
        `/accounts/${segment(account)}/tokens/verify`,
        Verified,
      )
    ).status === "active"
  );
}

const Subdomain = type({ subdomain: "string", "+": "ignore" });

/** The account's workers.dev subdomain, or undefined when it has none yet. */
export async function accountSubdomain(client: Client, account: string) {
  try {
    const { subdomain } = await call(
      client,
      "GET",
      `/accounts/${segment(account)}/workers/subdomain`,
      Subdomain,
    );
    return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain)
      ? subdomain
      : undefined;
  } catch (error) {
    // Cloudflare answers 404 for an account with no subdomain. A refused key is not handled here
    // because the next call refuses it too and reports it with its own code.
    if (error instanceof CloudflareRefused && error.status === 404)
      return undefined;
    throw error;
  }
}

export const enableWorkersDev = (
  client: Client,
  account: string,
  script: string,
) =>
  call(
    client,
    "POST",
    `${scripts(account, script)}/subdomain`,
    type("unknown"),
    { enabled: true, previews_enabled: false },
  );

const Scripts = type({ id: "string", "+": "ignore" }).array();
export const scriptNames = async (client: Client, account: string) =>
  (
    await call(
      client,
      "GET",
      `/accounts/${segment(account)}/workers/scripts`,
      Scripts,
    )
  ).map(({ id }) => id);

export const deleteScript = (client: Client, account: string, script: string) =>
  call(client, "DELETE", scripts(account, script), type("unknown"));

export type Binding =
  | { type: "plain_text"; name: string; text: string }
  | { type: "d1"; name: string; id: string }
  | { type: "assets"; name: string };

export type ScriptMetadata = {
  main_module: string;
  compatibility_date: string;
  compatibility_flags: readonly string[];
  bindings: readonly Binding[];
  assets?: { jwt: string; config: object };
};

/** Creates or replaces the script and makes it the version that answers. */
export async function uploadScript(
  client: Client,
  account: string,
  script: string,
  metadata: ScriptMetadata,
  module: { name: string; source: Uint8Array },
) {
  const form = new FormData();
  form.append(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: "application/json" }),
  );
  form.append(
    module.name,
    new File([new Uint8Array(module.source)], module.name, {
      type: "application/javascript+module",
    }),
  );
  await call(client, "PUT", scripts(account, script), type("unknown"), form);
}

export type AssetFile = {
  path: string;
  bytes: Uint8Array;
  contentType: string;
};

/**
 * A file's id in Cloudflare's asset store: the first 32 hex digits of the SHA-256 of its base64
 * content plus its extension. Cloudflare needs only an id that is stable for the same content; its
 * own tools use BLAKE3 the same way.
 */
export function assetHash({ path, bytes }: AssetFile) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const extension = name.includes(".")
    ? name.slice(name.lastIndexOf(".") + 1)
    : "";
  return createHash("sha256")
    .update(Buffer.from(bytes).toString("base64") + extension)
    .digest("hex")
    .slice(0, 32);
}

const Session = type({
  jwt: "string > 0",
  "buckets?": type("string").array().array().or("null"),
  "+": "ignore",
});

/**
 * Uploads the files Cloudflare does not have yet, with the upload session's token instead of the
 * account's. Returns the token that ties them to the next script upload.
 */
export async function uploadAssets(
  client: Client,
  account: string,
  script: string,
  files: readonly AssetFile[],
) {
  const byHash = new Map(files.map((file) => [assetHash(file), file]));
  const session = await call(
    client,
    "POST",
    `${scripts(account, script)}/assets-upload-session`,
    Session,
    {
      manifest: Object.fromEntries(
        files.map((file) => [
          file.path,
          { hash: assetHash(file), size: file.bytes.byteLength },
        ]),
      ),
    },
  );
  const buckets = session.buckets ?? [];
  if (buckets.length === 0) return session.jwt;
  let completion: string | undefined;
  for (const bucket of buckets) {
    const form = new FormData();
    for (const hash of bucket) {
      const file = byHash.get(hash);
      if (file === undefined) throw new CloudflareUnavailable();
      form.append(
        hash,
        new File([Buffer.from(file.bytes).toString("base64")], hash, {
          type: file.contentType,
        }),
      );
    }
    const uploaded = await call(
      // Not the saved key's fetch, which would add the key. The session token must be the only one.

      { fetch: client.plain, plain: client.plain, signal: client.signal },
      "POST",
      `/accounts/${segment(account)}/workers/assets/upload?base64=true`,
      type({ "jwt?": "string", "+": "ignore" }).or("null"),
      form,
      session.jwt,
    );
    if (uploaded?.jwt) completion = uploaded.jwt;
  }
  if (completion === undefined) throw new CloudflareUnavailable();
  return completion;
}

const Database = type({ uuid: "string > 0", "+": "ignore" });
export const createDatabase = async (
  client: Client,
  account: string,
  name: string,
) =>
  (
    await call(
      client,
      "POST",
      `/accounts/${segment(account)}/d1/database`,
      Database,
      { name },
    )
  ).uuid;

const Query = type({
  "results?": type({ "[string]": "unknown" }).array().or("null"),
  success: "boolean",
  "+": "ignore",
}).array();

/** Runs SQL against the database; several statements only without params, as D1 allows. */
export const query = (
  client: Client,
  account: string,
  database: string,
  sql: string,
  params?: readonly (string | number)[],
) =>
  call(
    client,
    "POST",
    `/accounts/${segment(account)}/d1/database/${segment(database)}/query`,
    Query,
    params === undefined ? { sql } : { sql, params },
  );
