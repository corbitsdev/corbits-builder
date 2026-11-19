import { parsed } from "@corbits-builder/plugin";
import {
  PUBLISH_HOLDING,
  PUBLISH_RELEASE,
  PublishHolding,
  PublishRelease,
  TAKE_DOWN_VALUES,
  takeDownAgreed,
} from "@corbits-builder/plugin/publish";
import {
  BuilderUnavailable,
  waitingWithin,
  type Clock,
  type RunHub,
} from "@corbits-builder/plugin/run-hub";
import type {
  ServerKeyRefusalCode,
  ServerKeyState,
} from "@corbits-builder/schemas/settings";
import {
  providerLine,
  WorkflowHttpError,
} from "@corbits-builder/plugin/http-json";
import { failed } from "@corbits-builder/plugin/tools";
import type { Outcome } from "./codes.ts";
import type { HostKey } from "./host-key.ts";
import {
  CHOICE,
  Choice,
  monthlyWords,
  PLACE,
  QUOTE,
  SERVER,
  SERVER_CREDENTIAL,
  ServerNote,
  TARGET,
  type BoundNote,
  type Quote,
  type Team,
  type UnboundNote,
} from "./target.ts";
import {
  ProviderRefused,
  ProviderUnavailable,
  SignedOut,
  type Account,
  type Server,
  type Vendor,
} from "./vendor.ts";

/** What a call that makes, looks at or removes the server works with. */
export type Deps = {
  vendor: Vendor;
  hub: RunHub;
  // The clock that waits read and sleep on.
  clock: Clock;
  // The time written into records.
  now(): Date;
  // Makes a host key pair for the server about to be created. The pair exists only in this call's
  // memory.
  hostKey(): Promise<HostKey>;
  // The tool call's signal. Cancelling the run ends every wait at once.
  signal: AbortSignal;
};

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
// DigitalOcean's listing can lag a create or a destroy by up to a minute. If nothing is listed this
// long after a create was tried, nothing was made.
const LISTING_LAG = { withinMs: 90 * SECOND, everyMs: 10 * SECOND };
const BIND_EVERY_MS = 10 * SECOND;
// How long DigitalOcean may still know a destroyed server's id before the call stops waiting.
const GONE = { withinMs: 90 * SECOND, everyMs: 5 * SECOND };
// An agent without a workspace gets ten minutes for its whole run, model turns included. A create
// call ends within this, leaving time for the turns that start it and explain the result.
const CALL_MS = 9 * MINUTE;
// Time limits for the calls that can still run after the bind's deadline: a DigitalOcean call, a
// bind on the hub, and a record on the hub.
const PROVIDER_CALL_MS = 30 * SECOND;
const BIND_CALL_MS = 45 * SECOND;
const RECORD_CALL_MS = 15 * SECOND;
// The work that can still run after the bind's deadline: the last look and bind that began before
// it; destroying the unbound server and waiting out GONE, including a last look that began before
// GONE ends; recording that nothing is held; and removing the login key from one page of the
// account's key list. The bind's deadline leaves this much of CALL_MS, so the call ends within it.
const TAIL_MS =
  PROVIDER_CALL_MS +
  BIND_CALL_MS +
  PROVIDER_CALL_MS +
  GONE.withinMs +
  PROVIDER_CALL_MS +
  RECORD_CALL_MS +
  2 * PROVIDER_CALL_MS;
// A server not bound this long after the call started is destroyed as too slow: whatever TAIL_MS
// leaves of CALL_MS, four minutes. Servers have been seen up with an address within 45 s, and
// accepting Builder's key about 140 s after their create, so that is ample.
export const BIND_WITHIN_MS = CALL_MS - TAIL_MS;
// How many servers are made for one agreed choice before the person is asked to choose again.
const MAX_TRIES = 3;

type Located = { server: Server } | { gone: true };
// taken means the hub refused the key as saved or bound elsewhere. The hub will not give this
// plugin the key or its label again.
type Key = ServerKeyState | { outcome: Outcome; taken?: true };

type Noted = ServerNote;

const notedOf = (values: Readonly<Record<string, unknown>>) =>
  parsed(ServerNote(values[SERVER]));

// Turns the hub's reason for not giving out the server key into an outcome.
const keyRefused = (
  refused: ServerKeyRefusalCode,
): { outcome: Outcome; taken?: true } =>
  refused === "server_key_taken" || refused === "server_key_bound_elsewhere"
    ? { outcome: failed("key_taken"), taken: true }
    : { outcome: failed("builder_unavailable") };

// The server key, which the hub makes on the first request. Only createServer asks for it.
async function serverKey(deps: Deps): Promise<Key> {
  const key = await deps.hub.serverKey(SERVER_CREDENTIAL);
  return "refused" in key ? keyRefused(key.refused) : key;
}

// The server key, or undefined if none was ever made, in which case no server was made with it.
async function heldKey(deps: Deps): Promise<Key | undefined> {
  const key = await deps.hub.heldServerKey(SERVER_CREDENTIAL);
  return key !== undefined && "refused" in key ? keyRefused(key.refused) : key;
}

const isOutcome = (
  value: object,
): value is { outcome: Outcome; taken?: true } => "outcome" in value;

// Turns a DigitalOcean failure into an outcome: a sign-in it kept refusing, a refusal with its
// message, or no answer. server names the server a removal could not reach, so the person can
// delete it at DigitalOcean themselves.
function providerOutcome(error: unknown, server?: string): Outcome {
  const at = server === undefined ? {} : { server };
  if (error instanceof SignedOut) return failed("signed_out", at);
  if (error instanceof ProviderRefused)
    return failed("provider_refused", { ...at, ...words(error.words) });
  if (error instanceof ProviderUnavailable)
    return failed("provider_unavailable", at);
  throw error;
}

// DigitalOcean's explanation as an outcome's message, when it gave one.
function words(message: string | undefined) {
  const line = providerLine(message);
  return line === undefined ? {} : { message: line };
}

// The team the server is, or would be, made under: the team recorded at the create, or else the
// team the person agreed to pay with.
const madeUnder = (noted: Noted | undefined, choice: Choice | undefined) =>
  noted?.team ?? choice?.team;

// DigitalOcean reports a server of another team as missing. So nothing is taken as gone, destroyed
// or cleared unless the sign-in reaches the team the server is made under.
function sameTeam(
  account: Account,
  expected: Team | undefined,
): Outcome | undefined {
  if (account.team === undefined) return failed("team_unknown");
  if (expected !== undefined && account.team.id === expected.id)
    return undefined;
  const team = providerLine(account.team.name);
  const agreed = providerLine(expected?.name);
  return failed("team_changed", {
    ...(team === undefined ? {} : { team }),
    ...(agreed === undefined ? {} : { agreed }),
  });
}

// The servers named label. When lagging is set because a create was tried, it waits out the
// listing's lag, since a server just made may not be listed yet.
async function findLagging(deps: Deps, label: string, lagging: boolean) {
  const more = waitingWithin(deps.clock, deps.signal, LISTING_LAG);
  for (;;) {
    const found = await deps.vendor.find(label);
    if (found.length > 0 || !lagging || !(await more())) return found;
  }
}

// Every server the project may have: the one with the recorded id, if DigitalOcean still knows it,
// and any named with the hub's label, when the label is known. After a create was tried it waits
// out the listing's lag, so it does not miss a server just made.
async function everyServer(
  deps: Deps,
  label: string | undefined,
  noted: Noted | undefined,
) {
  const recorded =
    noted?.id === undefined ? undefined : await deps.vendor.server(noted.id);
  const named =
    label === undefined
      ? []
      : await findLagging(
          deps,
          label,
          noted?.stage === "creating" && recorded === undefined,
        );
  return [
    ...(recorded === undefined ? [] : [recorded]),
    ...named.filter((server) => server.id !== recorded?.id),
  ];
}

// Destroys a server only if its name is the hub's label. Returns true once DigitalOcean no longer
// knows its id.
async function destroyConfirmed(
  deps: Deps,
  server: Server,
  label: string,
): Promise<boolean> {
  if (server.name !== label) return false;
  await deps.vendor.destroy(server.id);
  const more = waitingWithin(deps.clock, deps.signal, GONE);
  for (;;) {
    if ((await deps.vendor.server(server.id)) === undefined) return true;
    if (!(await more())) return false;
  }
}

// Removes the login key from the account's key list once nothing needs it. If that fails, only a
// public key is left there, and the next call that finds the server up, or the removal, removes it.
async function settleLater(deps: Deps, label: string) {
  try {
    await deps.vendor.settle(label);
  } catch (error) {
    if (deps.signal.aborted) throw error;
  }
}

const holding = (deps: Deps, choice: Choice): PublishHolding => ({
  target: TARGET,
  place: PLACE,
  since: deps.now().toISOString(),
  costs: monthlyWords(choice.monthly),
});

// This target's holding as the project recorded it, or undefined.
const heldHere = (value: unknown) => {
  const held = parsed(PublishHolding(value));
  return held?.target === TARGET ? held : undefined;
};

// The notes once nothing is held at DigitalOcean, keeping the count of tries for the choice.
const noneHeld = (tries: number, choice: Choice) => ({
  [SERVER]: { attempts: tries, for: choice.at } satisfies UnboundNote,
  [PUBLISH_HOLDING]: null,
});

// Finds the server Builder made by its recorded id, or by name after waiting out the listing's lag,
// or reports it gone.
async function locate(
  deps: Deps,
  label: string,
  noted: Noted | undefined,
  lagging: boolean,
): Promise<Located> {
  if (noted?.id !== undefined) {
    const server = await deps.vendor.server(noted.id);
    return server === undefined ? { gone: true } : { server };
  }
  const [server] = await findLagging(deps, label, lagging);
  return server === undefined ? { gone: true } : { server };
}

// Checks that the server the hub bound is still there, at the address it was bound to. If
// DigitalOcean reports it gone for the team it was made under, it no longer costs money or answers,
// so the server and its choice are forgotten. What was held and published there is cleared, and the
// next create waits until the person chooses a server and its price again. If the server is still
// there after the person said in the Publish tab that it is gone, its cost line is recorded again.
async function stillUp(
  deps: Deps,
  key: ServerKeyState,
  noted: Noted | undefined,
  choice: Choice,
  values: Readonly<Record<string, unknown>>,
): Promise<Outcome> {
  const held = heldHere(values[PUBLISH_HOLDING]);
  const located = await locate(deps, key.label, noted, true);
  if ("gone" in located) {
    const release = parsed(PublishRelease(values[PUBLISH_RELEASE]));
    // Clear the choice before revoking the key. If the call stops in between, the next create asks
    // the person to choose again instead of reusing the choice made for the server that is gone.
    await deps.hub.record({
      [SERVER]: null,
      [CHOICE]: null,
      ...(held === undefined ? {} : { [PUBLISH_HOLDING]: null }),
      ...(release?.target === TARGET ? { [PUBLISH_RELEASE]: null } : {}),
    });
    await deps.hub.revokeServerKey(SERVER_CREDENTIAL);
    await settleLater(deps, key.label);
    return failed("server_gone");
  }
  const { server } = located;
  const costs =
    held === undefined ? { [PUBLISH_HOLDING]: holding(deps, choice) } : {};
  const address =
    key.state === "bound" && server.address === key.address
      ? server.address
      : undefined;
  const note =
    address !== undefined &&
    (noted?.stage !== "bound" || noted.address !== address)
      ? {
          [SERVER]: {
            stage: "bound",
            id: server.id,
            address,
            label: key.label,
            team: noted?.team ?? choice.team,
          } satisfies BoundNote,
        }
      : {};
  if (Object.keys({ ...costs, ...note }).length > 0)
    await deps.hub.record({ ...costs, ...note });
  if (key.state === "lost") return failed("key_lost");
  if (address === undefined) return failed("address_differs");
  await settleLater(deps, key.label);
  return { ok: true, address, made: false };
}

// A server is made only if the live price is still the one the person agreed to, the account can
// create servers, and its team is the one they agreed to pay with. A price that went up or down
// stops the create and is recorded, so the account screen shows it when reopened.
async function agreedStill(
  deps: Deps,
  account: Account,
  choice: Choice,
): Promise<Outcome | undefined> {
  if (account.cannotCreate !== undefined)
    return failed("account_locked", words(account.cannotCreate.message));
  const otherTeam = sameTeam(account, choice.team);
  if (otherTeam !== undefined) return otherTeam;
  const monthly = await deps.vendor.price(choice.size, choice.region);
  if (monthly === undefined) return failed("size_unavailable");
  if (Math.round(monthly * 100) !== Math.round(choice.monthly * 100)) {
    const quote: Quote = { size: choice.size, monthly };
    await deps.hub.record({ [QUOTE]: quote });
    return failed("price_changed", { monthly, agreed: choice.monthly });
  }
  return undefined;
}

// Waits, until deadline, for the server to have a public address and for the hub to prove Builder's
// key on it, pinned to the host key made for it. taken means the hub will never bind it, because a
// key of the same name was saved or bound elsewhere since this call began.
async function bindBy(
  deps: Deps,
  server: Server,
  fingerprint: string,
  deadline: number,
): Promise<{ address: string } | { taken: true } | undefined> {
  const more = waitingWithin(deps.clock, deps.signal, {
    withinMs: Math.max(0, deadline - deps.clock.now()),
    everyMs: BIND_EVERY_MS,
  });
  for (;;) {
    const now = await deps.vendor.server(server.id);
    if (now === undefined) return undefined;
    if (now.state === "running" && now.address !== undefined) {
      const bound = await bindOnce(deps, now.address, fingerprint);
      if (bound !== undefined && !("refused" in bound))
        return { address: now.address };
      if (
        bound?.refused === "server_key_taken" ||
        bound?.refused === "server_key_bound_elsewhere"
      )
        return { taken: true };
      if (
        bound !== undefined &&
        bound.refused !== "server_unreachable" &&
        bound.refused !== "server_refused_key" &&
        bound.refused !== "server_host_key_mismatch"
      )
        return undefined;
    }
    if (!(await more())) return undefined;
  }
}

// One bind attempt, or undefined when the hub did not answer in time. The hub's sign-in to a server
// that is still starting can outlast the call, so a timeout means "not yet", like the server_
// refusals. A hub that answered with a refusal, as when the run lost its access, refuses every
// later request. The call then stops at once instead of waiting out the deadline and destroying a
// server that may be healthy. The creating note already names the server, so the next create or a
// take-down deals with it.
async function bindOnce(deps: Deps, host: string, fingerprint: string) {
  try {
    return await deps.hub.bindServerKey(SERVER_CREDENTIAL, {
      host,
      hostKey: fingerprint,
    });
  } catch (error) {
    if (
      deps.signal.aborted ||
      !(error instanceof BuilderUnavailable) ||
      (error.cause instanceof WorkflowHttpError && error.cause.refused)
    )
      throw error;
    return undefined;
  }
}

// The hub will not give this plugin a refused key or its label again, so only the note can find a
// server made with it: by its recorded id and label, under the team it was made under. Each server
// is destroyed. Once DigitalOcean confirms them gone, cleared is recorded and then key_taken is
// returned, so no server is left that nothing can find by name. A bound server is destroyed only at
// the address the note recorded, as a removal does.
async function forgetTaken(
  deps: Deps,
  noted: Noted | undefined,
  choice: Choice | undefined,
  cleared: Readonly<Record<string, null>>,
): Promise<Outcome> {
  if (noted?.id === undefined && noted?.label === undefined)
    return failed("key_taken");
  const { label } = noted;
  try {
    const account = await deps.vendor.account();
    const otherTeam = sameTeam(account, madeUnder(noted, choice));
    if (otherTeam !== undefined) return otherTeam;
    for (const server of await everyServer(deps, label, noted)) {
      // Without the label the server was made under, nothing proves a server is Builder's.
      if (label === undefined || server.name !== label)
        return failed("not_ours");
      if (
        noted.stage === "bound" &&
        server.id === noted.id &&
        server.address !== noted.address
      )
        return failed("address_differs");
      if (!(await destroyConfirmed(deps, server, label)))
        return failed("not_removed_yet");
    }
    if (label !== undefined) await settleLater(deps, label);
  } catch (error) {
    if (deps.signal.aborted) throw error;
    return providerOutcome(error, label);
  }
  await deps.hub.record(cleared);
  return failed("key_taken");
}

/**
 * Creates the server the person agreed to at DigitalOcean and has the hub prove Builder's key on
 * it, in one call, or reports that it is already up. A server is made only when the person's choice
 * still matches live prices, publish.holding is recorded, and no server with the hub's label
 * exists. A create that may have worked is looked for, not asked again, so one request never makes
 * two servers.
 *
 * A server that does not come up in time, that the hub will not bind, or that an earlier call left
 * unbound is destroyed, and its holding is cleared once DigitalOcean confirms it gone. Once the hub
 * refuses the key, a server the note still knows is destroyed before key_taken is returned. A bound
 * server that is gone is not made again automatically: Builder clears what it knew of it, and the
 * person chooses a server again. Nothing is taken as gone while the sign-in reaches a different
 * team from the one the server is made under.
 */
export async function createServer(deps: Deps): Promise<Outcome> {
  const started = deps.clock.now();
  const values = await deps.hub.values([
    CHOICE,
    SERVER,
    PUBLISH_HOLDING,
    PUBLISH_RELEASE,
  ]);
  const choice = parsed(Choice(values[CHOICE]));
  if (choice === undefined) return failed("no_choice");
  const noted = notedOf(values);
  const key = await serverKey(deps);
  // A create may destroy only a server that was never bound. A bound one is taken down only on the
  // person's go-ahead.
  if (isOutcome(key))
    return key.taken && noted?.stage === "creating"
      ? await forgetTaken(deps, noted, choice, {
          [SERVER]: null,
          ...(heldHere(values[PUBLISH_HOLDING]) === undefined
            ? {}
            : { [PUBLISH_HOLDING]: null }),
        })
      : key.outcome;
  try {
    const account = await deps.vendor.account();
    const otherTeam = sameTeam(account, madeUnder(noted, choice));
    if (otherTeam !== undefined) return otherTeam;
    if (key.state !== "issued")
      return await stillUp(deps, key, noted, choice, values);
    let tries =
      noted?.stage !== "bound" && noted?.for === choice.at ? noted.attempts : 0;
    // Any server with the hub's label at this point was made by a call that never bound it. Builder
    // does not trust a host key on first sight, so the server is destroyed and made again below.
    for (const leftover of await everyServer(deps, key.label, noted)) {
      if (leftover.name !== key.label) return failed("not_ours");
      if (!(await destroyConfirmed(deps, leftover, key.label)))
        return failed("not_removed_yet");
    }
    // A create was tried, or a server was bound before the key was issued again, and none of it is
    // left. Nothing is held until the next create.
    if (noted?.stage !== undefined)
      await deps.hub.record(noneHeld(tries, choice));
    const refused = await agreedStill(deps, account, choice);
    if (refused !== undefined) return refused;
    if (tries >= MAX_TRIES) return failed("too_many_tries");
    const hostKey = await deps.hostKey();
    tries++;
    const creating = {
      attempts: tries,
      for: choice.at,
      team: choice.team,
      label: key.label,
    };
    await deps.hub.record({
      [SERVER]: { stage: "creating", ...creating } satisfies UnboundNote,
      [PUBLISH_HOLDING]: holding(deps, choice),
    });
    const created = await createOnce(deps, key, choice, hostKey);
    if ("refused" in created) {
      await clearAfterRefusal(deps, key.label, tries, choice);
      return created.refused;
    }
    // The create failed and nothing was listed after the lag, but a server may still have been
    // made. The next call looks again before it clears what is held.
    if ("unknown" in created) return failed("provider_unavailable");
    const { server } = created;
    await deps.hub.record({
      [SERVER]: {
        stage: "creating",
        id: server.id,
        ...creating,
      } satisfies UnboundNote,
    });
    const bound = await bindBy(
      deps,
      server,
      hostKey.fingerprint,
      started + BIND_WITHIN_MS,
    );
    if (bound === undefined || "taken" in bound) {
      // Nothing can use a server the hub did not bind, and its host key is lost when this call
      // ends.
      if (!(await destroyConfirmed(deps, server, key.label)))
        return failed("not_removed_yet");
      await deps.hub.record(noneHeld(tries, choice));
      await settleLater(deps, key.label);
      return failed(bound === undefined ? "server_slow" : "key_taken");
    }
    await deps.hub.record({
      [SERVER]: {
        stage: "bound",
        id: server.id,
        address: bound.address,
        label: key.label,
        team: choice.team,
      } satisfies BoundNote,
    });
    // The key reached the server through the account's key list. The hub keeps it from here, so the
    // list entry can go.
    await settleLater(deps, key.label);
    return { ok: true, address: bound.address, made: true };
  } catch (error) {
    if (deps.signal.aborted) throw error;
    return providerOutcome(error);
  }
}

// DigitalOcean refused the create or the sign-in before anything was made. Clears what is held and
// removes the login key where that works. The caller returns the refusal whatever fails here,
// because the creating note leaves the rest to the next call.
async function clearAfterRefusal(
  deps: Deps,
  label: string,
  tries: number,
  choice: Choice,
) {
  try {
    await deps.hub.record(noneHeld(tries, choice));
    await deps.vendor.settle(label);
  } catch (error) {
    if (deps.signal.aborted) throw error;
  }
}

// Asks DigitalOcean once for the server. A refusal made nothing, and neither did a sign-in it kept
// refusing, because the shared client retries only after a refused sign-in. Any other failure may
// have made the server, so it is looked for by name instead of asked for again.
async function createOnce(
  deps: Deps,
  { label, publicKey }: ServerKeyState,
  choice: Choice,
  hostKey: HostKey,
): Promise<{ server: Server } | { refused: Outcome } | { unknown: true }> {
  try {
    return {
      server: await deps.vendor.create({
        label,
        size: choice.size,
        region: choice.region,
        loginKey: publicKey,
        userData: hostKey.userData,
      }),
    };
  } catch (error) {
    if (error instanceof ProviderRefused)
      return { refused: failed("create_refused", words(error.words)) };
    if (error instanceof SignedOut) return { refused: failed("signed_out") };
    if (!(error instanceof ProviderUnavailable)) throw error;
  }
  const [found] = await findLagging(deps, label, true);
  return found === undefined ? { unknown: true } : { server: found };
}

/**
 * Destroys the server Builder made at DigitalOcean. Once DigitalOcean confirms it gone, revokes its
 * key and clears what the project recorded of it and of the person's choice, in that order, so the
 * next removal finishes one that stopped part way. It acts only on the person's go-ahead for what
 * is recorded now, and only while the sign-in reaches the team the server is made under. Only a
 * server with the hub's label is destroyed, and the bound one only at the address the hub bound. If
 * DigitalOcean refuses the sign-in, nothing is cleared and the outcome names the server, so the
 * person can delete it there.
 */
export async function removeServer(deps: Deps): Promise<Outcome> {
  const values = await deps.hub.values([SERVER, CHOICE, ...TAKE_DOWN_VALUES]);
  if (!takeDownAgreed(values, TARGET)) return failed("not_agreed");
  const release = parsed(PublishRelease(values[PUBLISH_RELEASE]));
  const held = parsed(PublishHolding(values[PUBLISH_HOLDING]));
  const noted = notedOf(values);
  const choice = parsed(Choice(values[CHOICE]));
  // A new server after this needs the person's answer on the account screen again.
  const cleared = {
    ...(release?.target === TARGET ? { [PUBLISH_RELEASE]: null } : {}),
    ...(held?.target === TARGET ? { [PUBLISH_HOLDING]: null } : {}),
    [SERVER]: null,
    [CHOICE]: null,
  };
  const key = await heldKey(deps);
  // No key was ever made, so no server was either: there is nothing to look for or revoke.
  if (key === undefined) {
    await deps.hub.record(cleared);
    return { ok: true };
  }
  if (isOutcome(key))
    return key.taken
      ? await forgetTaken(deps, noted, choice, cleared)
      : key.outcome;
  try {
    const account = await deps.vendor.account();
    const otherTeam = sameTeam(account, madeUnder(noted, choice));
    if (otherTeam !== undefined) return otherTeam;
    // Look by recorded id and by the hub's label. Otherwise a server that only the label finds
    // would be left behind once the key, and its label, are revoked.
    for (const server of await everyServer(deps, key.label, noted)) {
      if (server.name !== key.label) return failed("not_ours");
      const theBound =
        key.state !== "issued" &&
        (noted?.id === undefined || server.id === noted.id);
      if (theBound && server.address !== key.address)
        return failed("address_differs");
      if (!(await destroyConfirmed(deps, server, key.label)))
        return failed("not_removed_yet");
    }
    await deps.vendor.settle(key.label);
  } catch (error) {
    if (deps.signal.aborted) throw error;
    return providerOutcome(error, key.label);
  }
  await deps.hub.revokeServerKey(SERVER_CREDENTIAL);
  await deps.hub.record(cleared);
  return { ok: true };
}

/** Whether DigitalOcean still has the server Builder made, and its state and address there. */
export async function serverStatus(deps: Deps): Promise<Outcome> {
  const values = await deps.hub.values([SERVER, CHOICE]);
  const noted = notedOf(values);
  if (noted?.stage === undefined) return { ok: true, state: "none" };
  const key = await heldKey(deps);
  if (key === undefined) return { ok: true, state: "none" };
  if (isOutcome(key)) return key.outcome;
  try {
    const account = await deps.vendor.account();
    const otherTeam = sameTeam(
      account,
      madeUnder(noted, parsed(Choice(values[CHOICE]))),
    );
    if (otherTeam !== undefined) return otherTeam;
    const located = await locate(deps, key.label, noted, false);
    if ("gone" in located) return { ok: true, state: "none" };
    const { server } = located;
    return {
      ok: true,
      state: server.state,
      ...(server.address === undefined ? {} : { address: server.address }),
    };
  } catch (error) {
    if (deps.signal.aborted) throw error;
    return providerOutcome(error);
  }
}
