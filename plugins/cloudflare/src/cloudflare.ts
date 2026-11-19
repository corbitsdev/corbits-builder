import { gzipSync } from "node:zlib";
import { parsed } from "@corbits-builder/plugin";
import { type } from "arktype";
import {
  BuilderUnavailable,
  waitingWithin,
  type RunHub,
} from "@corbits-builder/plugin/run-hub";
import { failed } from "@corbits-builder/plugin/tools";
import {
  PUBLISH_KEEP,
  PUBLISH_RELEASE,
  PublishKeep,
  PublishRelease,
  TAKE_DOWN_VALUES,
  takeDownAgreed,
} from "@corbits-builder/publish-contract";
import {
  accountSubdomain,
  CloudflareRefused,
  CloudflareUnavailable,
  createDatabase,
  createTemporaryAccount,
  deleteScript,
  enableWorkersDev,
  keyActive,
  listAccounts,
  query,
  requestChallenge,
  scriptNames,
  uploadAssets,
  uploadScript,
  type Binding,
  type Client,
  type Fetch,
  type Temporary,
} from "./api.ts";
import {
  builtApp,
  savedApp,
  type BuiltApp,
  type SavedApp,
} from "./app-files.ts";
import { solvable, solve } from "./challenge.ts";
import { isOutcome, type Outcome } from "./codes.ts";
import type { WorkersConfig } from "./config.ts";
import {
  CloudflareSite,
  SITE,
  TARGET,
  TERMS,
  TERMS_STAND_MS,
} from "./target.ts";

export type { Outcome } from "./codes.ts";

export type Deps = {
  hub: RunHub;
  // A fetch that sends the person's saved key, or undefined when no key is saved.
  key(): Promise<Fetch | undefined>;
  // A fetch that adds no credentials, for calls that send a temporary account's token or an upload
  // session's.
  fetch: Fetch;
  // The HTTP status the address returns, or undefined when it does not respond.
  visit(url: string): Promise<number | undefined>;
  sleep(ms: number): Promise<void>;
  now(): Date;
  signal: AbortSignal;
};

// The permission a saved key needs for each kind of call, as Cloudflare's dashboard names it.
// https://developers.cloudflare.com/fundamentals/api/reference/permissions/
const PERMISSION = {
  account: "Account Settings Read",
  workers: "Workers Scripts Edit",
  database: "D1 Edit",
} as const;
type Permission = keyof typeof PERMISSION;

// Cloudflare's error codes for a refused key, a worker that throws at startup, and a worker larger
// than the plan allows.
const AUTHENTICATION = 10000;
const SCRIPT_STARTUP = 10021;
const SCRIPT_TOO_LARGE = 10027;

// A temporary account's limits, from Cloudflare's page on them. The person's own account gets the
// general Workers limits, and Cloudflare enforces those itself.
// https://developers.cloudflare.com/workers/platform/claim-deployments/
const LIMITS = {
  temporary: { files: 1_000, fileBytes: 5 * 1024 * 1024 },
  own: { files: 20_000, fileBytes: 25 * 1024 * 1024 },
};
// A free plan's worker, compressed. https://developers.cloudflare.com/workers/platform/limits/
const WORKER_GZIP_BYTES = 3 * 1024 * 1024;
const ANSWER_WAIT_MS = 120_000;
const ANSWER_EVERY_MS = 3_000;
// Cloudflare's page gives a temporary account an hour. Builder assumes that hour when the deadline
// Cloudflare returns is not a valid date, because showing the keep link matters more than the
// exact minute.
const KEEP_FOR_MS = 60 * 60_000;
// For a few seconds after creating a temporary account, Cloudflare refuses its token on some calls.
// Within this minute a refusal means the account is not ready yet. The wait adds at most a minute
// to the two minutes a release already waits for the address to answer.
const SETTLES_WITHIN_MS = 60_000;
const SETTLE_EVERY_MS = 2_000;
// How far in the future an acceptance time may be, because the hub's clock and this one can
// disagree slightly. A time further ahead is not a real acceptance.
const CLOCK_SKEW_MS = 60_000;

type Account = "own" | "temporary";

// The person's own account, reached through their saved key.
type Own = { account: "own"; client: Client; id: string };

// Where a publish goes: the account, how calls reach it, its workers.dev subdomain and, for a
// temporary account, when Cloudflare removes it unless the person keeps it.
type Destination = {
  account: Account;
  client: Client;
  id: string;
  subdomain: string;
  keepUntil?: string;
};

const siteOf = (values: Readonly<Record<string, unknown>>) =>
  parsed(CloudflareSite(values[SITE]));

const set = (value: unknown) => value !== undefined && value !== null;

/**
 * Maps a thrown error to cloudflare_unavailable for a Cloudflare failure, else to
 * builder_unavailable.
 */
function outcomeOf(error: unknown): Outcome {
  if (
    error instanceof CloudflareUnavailable ||
    error instanceof CloudflareRefused
  )
    return failed("cloudflare_unavailable");
  return failed("builder_unavailable");
}

const keyRefusal = (error: CloudflareRefused) =>
  error.status === 401 ||
  error.status === 403 ||
  error.codes.includes(AUTHENTICATION);

/**
 * Runs a call to Cloudflare. In the person's own account, a refused key becomes key_refused with
 * the permission the call needs. `refused` turns any other refusal into an outcome, and the error
 * is rethrown when it returns undefined.
 */
async function calling<T>(
  account: Account,
  permission: Permission,
  run: () => Promise<T>,
  refused: (error: CloudflareRefused) => Outcome | undefined = () => undefined,
): Promise<T | Outcome> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof CloudflareRefused)) throw error;
    if (account === "own" && keyRefusal(error))
      return failed("key_refused", { permission: PERMISSION[permission] });
    const outcome = refused(error);
    if (outcome === undefined) throw error;
    return outcome;
  }
}

// Whether the person accepted Cloudflare's terms for a temporary account within the hour.
function accepted(deps: Deps, values: Readonly<Record<string, unknown>>) {
  const at = values[TERMS];
  if (typeof at !== "string") return false;
  const since = deps.now().getTime() - new Date(at).getTime();
  return since >= -CLOCK_SKEW_MS && since <= TERMS_STAND_MS;
}

/**
 * Picks the account a publish goes to: the person's own when a key is saved, or a temporary one
 * when they accepted Cloudflare's terms within the hour. Otherwise returns no_account_chosen.
 * Creates no account.
 */
async function chosenAccount(
  deps: Deps,
  values: Readonly<Record<string, unknown>>,
): Promise<Own | { account: "temporary" } | Outcome> {
  const key = await deps.key();
  if (key === undefined) {
    if (accepted(deps, values)) return { account: "temporary" };
    // Clear an expired acceptance so Builder asks the person again before the next publish.
    if (set(values[TERMS])) await deps.hub.record({ [TERMS]: null });
    return failed("no_account_chosen");
  }
  const client: Client = { fetch: key, plain: deps.fetch, signal: deps.signal };
  const recorded = siteOf(values)?.account;
  const accounts = await calling("own", "account", () => listAccounts(client));
  if (isOutcome(accounts)) {
    // Cloudflare refuses an expired or revoked key on every call except verification, and
    // verification needs the account the key was made in. A key that still verifies lacks the
    // permission.
    if (recorded === undefined) return accounts;
    const active = await calling("own", "account", () =>
      keyActive(client, recorded),
    );
    return active === false ? failed("key_refused") : accounts;
  }
  const id =
    recorded !== undefined && accounts.includes(recorded)
      ? recorded
      : accounts.length === 1
        ? accounts[0]
        : undefined;
  if (id === undefined)
    return accounts.length === 0
      ? failed("key_refused", { permission: PERMISSION.account })
      : failed("several_accounts");
  const active = await calling("own", "account", () => keyActive(client, id));
  if (isOutcome(active)) return active;
  if (!active) return failed("key_refused");
  return { account: "own", client, id };
}

/** Returns too_large when the built app exceeds the account's limits, before creating anything. */
function beyondLimits(
  account: Account,
  { worker, assets }: BuiltApp,
): Outcome | undefined {
  const limits = LIMITS[account];
  if (assets.length > limits.files)
    return failed("too_large", {
      limit: "files",
      files: assets.length,
      maxFiles: limits.files,
    });
  if (assets.some(({ bytes }) => bytes.byteLength > limits.fileBytes))
    return failed("too_large", {
      limit: "file_size",
      maxMb: limits.fileBytes / 1024 / 1024,
    });
  if (
    account === "temporary" &&
    gzipSync(worker).byteLength > WORKER_GZIP_BYTES
  )
    return failed("too_large", {
      limit: "worker_size",
      maxMb: WORKER_GZIP_BYTES / 1024 / 1024,
    });
  return undefined;
}

/**
 * Builds the destination in the person's own account. Fails when the account has no workers.dev
 * subdomain or another app already uses the name.
 */
async function ownDestination(
  { client, id }: Own,
  script: string,
  site: CloudflareSite | undefined,
): Promise<Destination | Outcome> {
  const subdomain = await calling("own", "workers", () =>
    accountSubdomain(client, id),
  );
  if (isOutcome(subdomain)) return subdomain;
  if (subdomain === undefined) return failed("no_subdomain");
  // If this project did not publish the worker with that name, it belongs to another app, and
  // replacing it would take that app down.
  if (site?.account !== id || site.script !== script) {
    const names = await calling("own", "workers", () =>
      scriptNames(client, id),
    );
    if (isOutcome(names)) return names;
    if (names.includes(script)) return failed("name_taken");
  }
  return { account: "own", client, id, subdomain };
}

/**
 * Creates the temporary account the person accepted Cloudflare's terms for. Cloudflare may refuse.
 */
async function madeTemporaryAccount(deps: Deps): Promise<Temporary | Outcome> {
  const plain: Client = {
    fetch: deps.fetch,
    plain: deps.fetch,
    signal: deps.signal,
  };
  // Cloudflare may refuse, for example at its limit on new accounts. Builder does not retry.
  const notCreated = () => failed("account_not_created");
  const challenge = await calling(
    "temporary",
    "account",
    () => requestChallenge(plain),
    notCreated,
  );
  if (isOutcome(challenge)) return challenge;
  if (!solvable(challenge)) throw new CloudflareUnavailable();
  const proof = await solve(challenge);
  return calling(
    "temporary",
    "account",
    () => createTemporaryAccount(plain, challenge.challengeToken, proof),
    notCreated,
  );
}

const siteFor = (
  destination: Pick<Destination, "account" | "id" | "keepUntil">,
  script: string,
  database: string | undefined,
): CloudflareSite => ({
  account: destination.id,
  script,
  ...(database === undefined ? {} : { database }),
  temporary: destination.account === "temporary",
  ...(destination.keepUntil === undefined
    ? {}
    : { keepUntil: destination.keepUntil }),
});

// Saves values that must survive a brief hub outage, retrying once when the hub is unavailable.
async function recordSurely(
  deps: Deps,
  values: Readonly<Record<string, unknown>>,
) {
  try {
    await deps.hub.record(values);
  } catch (error) {
    if (!(error instanceof BuilderUnavailable) || deps.signal.aborted)
      throw error;
    await deps.hub.record(values);
  }
}

/**
 * Saves the link to keep a new temporary account and the site record, and clears the used
 * acceptance. It runs before anything else can fail, so the person can always keep the account or
 * let it lapse. Returns the time Cloudflare removes the account unless it is kept.
 */
async function savedKeepLink(
  deps: Deps,
  made: Temporary,
  script: string,
): Promise<string> {
  const deadline = new Date(made.claim.expiresAt);
  const keepUntil = (
    Number.isNaN(deadline.getTime())
      ? new Date(deps.now().getTime() + KEEP_FOR_MS)
      : deadline
  ).toISOString();
  const keep = PublishKeep({
    link: made.claim.url,
    until: keepUntil,
    place: "Cloudflare",
  });
  if (keep instanceof type.errors) throw new CloudflareUnavailable();
  await recordSurely(deps, {
    [TERMS]: null,
    [PUBLISH_KEEP]: keep,
    [SITE]: siteFor(
      { account: "temporary", id: made.account.id, keepUntil },
      script,
      undefined,
    ),
  });
  return keepUntil;
}

/**
 * Decides whether to retry a refusal of a new temporary account's token. While the account is
 * younger than SETTLES_WITHIN_MS, an authentication refusal means it is not ready yet: wait and
 * retry. Any other refusal, or one after that, is not retried.
 */
function untilSettled(deps: Deps, madeAt: number) {
  const settling = waitingWithin(
    { now: () => deps.now().getTime(), sleep: deps.sleep },
    deps.signal,
    { withinMs: SETTLES_WITHIN_MS, everyMs: SETTLE_EVERY_MS, from: madeAt },
  );
  return async (refusal: CloudflareRefused) =>
    (refusal.status === 401 || refusal.status === 403) &&
    refusal.codes.includes(AUTHENTICATION) &&
    settling();
}

/**
 * Builds the destination in the new temporary account. Its client sends the account's token and,
 * on every later call in the release, waits for Cloudflare to accept that token.
 */
async function temporaryDestination(
  deps: Deps,
  made: Temporary,
  madeAt: number,
  keepUntil: string,
): Promise<Destination> {
  const client: Client = {
    fetch: deps.fetch,
    plain: deps.fetch,
    token: made.account.apiToken,
    signal: deps.signal,
    again: untilSettled(deps, madeAt),
  };
  const subdomain = await accountSubdomain(client, made.account.id);
  if (subdomain === undefined) throw new CloudflareUnavailable();
  return {
    account: "temporary",
    client,
    id: made.account.id,
    subdomain,
    keepUntil,
  };
}

/**
 * Readies the database the worker binds. It is created on the first publish to this account and
 * reused after that. Each migration file runs once, in name order, and is recorded in the table
 * Cloudflare's own tools use. A failed migration stops the publish before visitors see any change.
 */
async function readyDatabase(
  deps: Deps,
  destination: Destination,
  { config, migrations }: SavedApp,
  site: CloudflareSite | undefined,
): Promise<string | undefined | Outcome> {
  const declared = config.database;
  if (declared === undefined) return undefined;
  const { account, client } = destination;
  const at = destination.id;
  let found = site?.account === at ? site.database : undefined;
  if (found === undefined) {
    const created = await calling(
      account,
      "database",
      () => createDatabase(client, at, declared.name ?? config.name),
      () => failed("database_not_created"),
    );
    if (isOutcome(created)) return created;
    found = created;
    // Record it now, so a publish stopped after this point reuses it instead of creating a second
    // database with the same name.
    await deps.hub.record({ [SITE]: siteFor(destination, config.name, found) });
  }
  const id = found;
  const { table } = declared;
  const applied = await calling(account, "database", async () => {
    await query(
      client,
      at,
      id,
      `CREATE TABLE IF NOT EXISTS ${table} (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)`,
    );
    const [listed] = await query(client, at, id, `SELECT name FROM ${table}`);
    const names = new Set<string>();
    for (const row of listed?.results ?? [])
      if (typeof row["name"] === "string") names.add(row["name"]);
    return names;
  });
  if (isOutcome(applied)) return applied;
  for (const { name, sql } of migrations) {
    if (applied.has(name)) continue;
    // The migration and its record go in one request, as Cloudflare's own tools send them, so a
    // migration is recorded only if it ran. D1 accepts several statements only without params.
    // MIGRATION allows only plain names, so the name is written into the SQL directly.
    const body = sql.trimEnd().replace(/;+$/, "");
    const ran = await calling(
      account,
      "database",
      () =>
        query(
          client,
          at,
          id,
          `${body};\nINSERT INTO ${table} (name) VALUES ('${name}');`,
        ),
      () => failed("migration_failed", { migration: name }),
    );
    if (isOutcome(ran)) return ran;
  }
  return id;
}

/** The worker's bindings: its plain vars, NODE_ENV as production, its database and its assets. */
const bindingsOf = (
  config: WorkersConfig,
  database: string | undefined,
): Binding[] => [
  ...Object.entries(config.vars)
    .filter(([name]) => name !== "NODE_ENV")
    .map(([name, text]): Binding => ({ type: "plain_text", name, text })),
  { type: "plain_text", name: "NODE_ENV", text: "production" },
  ...(config.database && database !== undefined
    ? [{ type: "d1", name: config.database.binding, id: database } as const]
    : []),
  ...(config.assets?.binding
    ? [{ type: "assets", name: config.assets.binding } as const]
    : []),
];

/** Uploads the static assets and the worker, and turns on the worker's workers.dev address. */
async function upload(
  { account, client, id }: Destination,
  { config }: SavedApp,
  { worker, assets }: BuiltApp,
  database: string | undefined,
): Promise<Outcome | undefined> {
  const script = config.name;
  const jwt = config.assets
    ? await calling(account, "workers", () =>
        uploadAssets(client, id, script, assets),
      )
    : undefined;
  if (isOutcome(jwt)) return jwt;
  const module = config.main.slice(config.main.lastIndexOf("/") + 1);
  const uploaded = await calling(
    account,
    "workers",
    async () => {
      await uploadScript(
        client,
        id,
        script,
        {
          main_module: module,
          compatibility_date: config.compatibilityDate,
          compatibility_flags: config.compatibilityFlags,
          bindings: bindingsOf(config, database),
          ...(config.assets && jwt !== undefined
            ? { assets: { jwt, config: config.assets.config } }
            : {}),
        },
        { name: module, source: worker },
      );
      await enableWorkersDev(client, id, script);
    },
    (error) =>
      error.codes.includes(SCRIPT_STARTUP)
        ? failed("worker_refused")
        : error.codes.includes(SCRIPT_TOO_LARGE)
          ? failed("too_large", { limit: "worker_size" })
          : undefined,
  );
  return isOutcome(uploaded) ? uploaded : undefined;
}

/** Readies the database and uploads the app to the destination; returns the database it binds. */
async function publishTo(
  deps: Deps,
  destination: Destination,
  saved: SavedApp,
  built: BuiltApp,
  site: CloudflareSite | undefined,
): Promise<{ database?: string } | Outcome> {
  const database = await readyDatabase(deps, destination, saved, site);
  if (isOutcome(database)) return database;
  const failure = await upload(destination, saved, built, database);
  if (failure !== undefined) return failure;
  return database === undefined ? {} : { database };
}

// The app answers with any status but 404 or 5xx. Cloudflare shows a 404 page until a new worker
// is reachable, and a 5xx is a failure on Cloudflare's side.
const answers = (status: number | undefined) =>
  status !== undefined && status !== 404 && status < 500;

async function answersWithin(deps: Deps, url: string, ms: number) {
  const until = deps.now().getTime() + ms;
  for (;;) {
    if (answers(await deps.visit(url))) return true;
    if (deps.now().getTime() >= until) return false;
    await deps.sleep(ANSWER_EVERY_MS);
  }
}

const minutesLeft = (deps: Deps, until: string) =>
  Math.max(
    0,
    Math.floor((new Date(until).getTime() - deps.now().getTime()) / 60_000),
  );

/**
 * Records the release, because the app is published once the upload is done, then waits for the
 * address to answer. Returns not_answering_yet if Cloudflare takes longer than that to serve it.
 */
async function finish(
  deps: Deps,
  destination: Destination,
  saved: SavedApp,
  database: string | undefined,
  values: Readonly<Record<string, unknown>>,
): Promise<Outcome> {
  const script = saved.config.name;
  const url = `https://${script}.${destination.subdomain}.workers.dev/`;
  const release: PublishRelease = {
    target: TARGET,
    url,
    version: saved.version,
    at: deps.now().toISOString(),
    // An account Builder made is not the person's, so the next publish cannot update this app
    // until they keep it and save a key for it.
    ...(destination.account === "own" ? {} : { replaceable: false as const }),
  };
  await recordSurely(deps, {
    [SITE]: siteFor(destination, script, database),
    [PUBLISH_RELEASE]: release,
    // A publish with the person's own key leaves no temporary account to keep. It also settles
    // which account they publish with, so any earlier acceptance of the terms is cleared.
    ...(destination.account === "own"
      ? {
          [PUBLISH_KEEP]: null,
          ...(set(values[TERMS]) ? { [TERMS]: null } : {}),
        }
      : {}),
  });
  const keep =
    destination.keepUntil === undefined
      ? {}
      : { keepWithinMinutes: minutesLeft(deps, destination.keepUntil) };
  if (!(await answersWithin(deps, url, ANSWER_WAIT_MS)))
    return failed("not_answering_yet", { url, ...keep });
  return { ok: true, url, ...keep };
}

/** Publishes the saved app to Cloudflare, records it, and waits for its address to answer. */
async function releaseApp(deps: Deps): Promise<Outcome> {
  const values = await deps.hub.values([
    "stack.production",
    PUBLISH_RELEASE,
    SITE,
    TERMS,
  ]);
  const saved = await savedApp(deps.hub, values);
  if (isOutcome(saved)) return saved;
  const chosen = await chosenAccount(deps, values);
  if (isOutcome(chosen)) return chosen;
  const built = await builtApp(deps.hub, saved);
  if (isOutcome(built)) return built;
  const beyond = beyondLimits(chosen.account, built);
  if (beyond !== undefined) return beyond;
  const site = siteOf(values);
  const script = saved.config.name;

  if (chosen.account === "own") {
    const destination = await ownDestination(chosen, script, site);
    if (isOutcome(destination)) return destination;
    const published = await publishTo(deps, destination, saved, built, site);
    if (isOutcome(published)) return published;
    return finish(deps, destination, saved, published.database, values);
  }

  const made = await madeTemporaryAccount(deps);
  if (isOutcome(made)) return made;
  const madeAt = deps.now().getTime();
  // The account exists from here, with its token and the link to keep it. Until the app reaches
  // it, a failure says whether the person can still keep that empty account.
  let keepUntil: string;
  try {
    keepUntil = await savedKeepLink(deps, made, script);
  } catch (error) {
    return { ...outcomeOf(error), emptyTemporaryAccount: "unreachable" };
  }
  let reached: { destination: Destination; database?: string } | Outcome;
  try {
    const destination = await temporaryDestination(
      deps,
      made,
      madeAt,
      keepUntil,
    );
    const published = await publishTo(deps, destination, saved, built, site);
    reached = isOutcome(published) ? published : { destination, ...published };
  } catch (error) {
    reached = outcomeOf(error);
  }
  if (isOutcome(reached))
    return { ...reached, emptyTemporaryAccount: "keepable" };
  return finish(deps, reached.destination, saved, reached.database, values);
}

const recordedRelease = (values: Readonly<Record<string, unknown>>) => {
  const release = PublishRelease(values[PUBLISH_RELEASE]);
  return release instanceof type.errors || release.target !== TARGET
    ? undefined
    : release;
};

/** Whether the address the app was last published at answers. */
async function statusOf(deps: Deps): Promise<Outcome> {
  const release = recordedRelease(await deps.hub.values([PUBLISH_RELEASE]));
  if (release === undefined) return { ok: true, state: "not_published" };
  return {
    ok: true,
    state: answers(await deps.visit(release.url))
      ? "answering"
      : "not_answering",
    url: release.url,
  };
}

/**
 * Deletes the worker with the saved key and keeps its database and data. It needs the person's
 * go-ahead on the take-down screen for the release that is published now.
 */
async function unpublishApp(deps: Deps): Promise<Outcome> {
  const values = await deps.hub.values([...TAKE_DOWN_VALUES, SITE]);
  if (!takeDownAgreed(values, TARGET)) return failed("not_agreed");
  const site = siteOf(values);
  if (site === undefined) return failed("not_published");
  const key = await deps.key();
  if (key === undefined)
    return failed("needs_own_account", { temporary: site.temporary });
  const client: Client = { fetch: key, plain: deps.fetch, signal: deps.signal };
  const accounts = await calling("own", "account", () => listAccounts(client));
  if (isOutcome(accounts)) return accounts;
  if (!accounts.includes(site.account))
    return failed("other_account", { temporary: site.temporary });
  const deleted = await calling(
    "own",
    "workers",
    () => deleteScript(client, site.account, site.script),
    // Already gone, as when the person removed it in their dashboard.
    (error) => (error.status === 404 ? { ok: true } : undefined),
  );
  if (isOutcome(deleted) && !deleted.ok) return deleted;
  await deps.hub.record({
    ...(recordedRelease(values) === undefined
      ? {}
      : { [PUBLISH_RELEASE]: null }),
    [PUBLISH_KEEP]: null,
  });
  return { ok: true, databaseKept: site.database !== undefined };
}

// Each step returns its failures as outcomes. An error a step throws becomes cloudflare_unavailable
// or builder_unavailable here.
const handled =
  (tool: (deps: Deps) => Promise<Outcome>) =>
  async (deps: Deps): Promise<Outcome> => {
    try {
      return await tool(deps);
    } catch (error) {
      return outcomeOf(error);
    }
  };

export const release = handled(releaseApp);
export const status = handled(statusOf);
export const unpublish = handled(unpublishApp);
