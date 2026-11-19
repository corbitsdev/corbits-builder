// The runtime mediated-credential surface: how a resolved provider-backed
// credential reaches the consumer that uses it (a tool, or the built-in
// reactor) WITHOUT handing over the raw secret.
//
// A consumer declares a credential handle (see `ToolCredentialHandle`) and, at
// handler-init, resolves a *mediated credential* -- a handle that lets it
// authenticate against the provider without holding the secret on its own API.
// An HTTP credential mediates by exposing an authed `fetch` pinned to the
// credential's provider origin; the bearer token is injected per request and
// never surfaced.
//
// Honest scope of the mediation: it is NOT containment against hostile tool
// code. A tool that legitimately receives an http mediated credential can read
// the Authorization header the fetch sends. What mediation buys is (a) the
// secret is off the tool's declared API surface, (b) a single rotation point --
// material is read fresh per use, so a rotation reaches every holder without
// re-shaping the handle -- and (c) consumer-scoped resolution. Confidentiality
// from the receiving tool needs process/VM isolation, a different boundary.
//
// The provider plugin owns how a handle is shaped; the acquisition of material
// (resolve a credential row, authorize, decrypt) lives on the delivery side and
// is never the plugin's decision.

/** The current secret material behind a credential, read fresh at each use. */
export interface CredentialMaterial {
  readonly secret: string;
}

/**
 * Reads the current material for one credential. A provider handle calls this
 * per use rather than capturing a snapshot, so a rotation that updates the
 * underlying cell is picked up without rebuilding the handle.
 */
export type CredentialMaterialSource = () => CredentialMaterial;

/**
 * Resolves the current material for a credential BY id from the run's
 * credential cell. Inference uses this to fill a request's credential from
 * `InferenceSource.credentialId` at send time -- the same cell binding
 * credentials resolve from, so neither rail holds an inline secret. Keyed by
 * `credentialId` (not bound to one, unlike `CredentialMaterialSource`) because
 * a source's forward-only failover chain carries a distinct credential per
 * entry. Reads live, so a rotation of the cell is picked up on the next call;
 * fails closed when the credential is absent (revoked or never delivered). This
 * is the single seam a future mode swaps to keep the raw secret out of the
 * child entirely.
 */
export type CredentialMaterialResolver = (
  credentialId: string,
) => CredentialMaterial;

/** What a provider plugin is given to shape a mediated credential. */
export interface CredentialShapeContext {
  /**
   * The provider origin the credential authenticates to (e.g.
   * `https://api.github.com`). An http handle pins its requests to this origin.
   */
  readonly origin: string;
  /** Reads the current secret material at each use (rotation indirection). */
  readCurrentMaterial: CredentialMaterialSource;
}

/** Fields shared by every mediated-credential variant. */
export interface MediatedCredentialBase {
  /** Discriminates the variant a consumer narrows on. */
  readonly kind: string;
  /**
   * Release resources the handle allocated. An http handle allocates none; a
   * future key-file/socket handle would. Idempotent; run on teardown.
   */
  dispose(): void | Promise<void>;
}

/**
 * An HTTP-authenticated mediated credential: an authed `fetch` pinned to the
 * credential's provider origin. A request whose resolved origin is not the
 * pinned one is refused, and redirects are not followed (a 3xx is returned to
 * the caller), so the bearer token is only ever sent to the pinned origin and a
 * holder cannot redirect it to an attacker-chosen host.
 */
export interface HttpMediatedCredential extends MediatedCredentialBase {
  readonly kind: "http";
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
}

/** How one command run through an ssh mediated credential is bounded. */
export interface SshExecOptions {
  /** Bytes written to the command's standard input, which is then closed. */
  readonly stdin?: Uint8Array;
  /**
   * The call rejects as `timeout` once this long has passed, and the command
   * is asked to stop as an abort asks it.
   */
  readonly timeoutMs: number;
  /** The most bytes kept of each output stream; the rest is dropped. */
  readonly maxOutputBytes?: number;
  /**
   * Aborting it rejects the call as `cancelled` and asks the command to stop:
   * a KILL signal request, then its session closed. A server that takes signal
   * requests (OpenSSH 7.9 and later, unless turned off) kills it; elsewhere it
   * ends only once it writes to its closed output or its shell hangs it up, so
   * a command that must not run on is one that stops itself, such as under
   * `timeout`.
   */
  readonly signal?: AbortSignal;
}

/** What one command run through an ssh mediated credential left behind. */
export interface SshExecResult {
  /** The command's exit status, or null when a signal ended it. */
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Whether either stream was longer than the cap and cut. */
  readonly truncated: boolean;
}

/** Why an ssh handle refused or failed, each a code a caller branches on. */
export const SSH_CREDENTIAL_FAILURES = [
  "invalid_origin",
  "invalid_secret",
  "address_mismatch",
  "address_refused",
  "unreachable",
  "host_key_changed",
  "auth_failed",
  "timeout",
  "cancelled",
  "invalid_command",
] as const;
export type SshCredentialFailure = (typeof SSH_CREDENTIAL_FAILURES)[number];

/**
 * The failure an ssh handle's error names, or undefined for any other error.
 * It reads the error's name and code rather than its class, because a
 * consumer bundled with its own copy of the provider sees another class.
 */
export function sshCredentialFailure(
  error: unknown,
): SshCredentialFailure | undefined {
  if (
    !(error instanceof Error) ||
    error.name !== "SshCredentialError" ||
    !("failure" in error)
  )
    return undefined;
  const { failure } = error;
  return SSH_CREDENTIAL_FAILURES.find((known) => known === failure);
}

/**
 * An SSH-authenticated mediated credential: one `exec` on a connection pinned
 * to the credential's provider origin (`ssh://host:port`) and to the host key
 * the credential was saved with. It connects nowhere else, and a server that
 * presents another host key is refused before anything is sent to it. The
 * command is an argument list the handle quotes itself, so a caller's values
 * never reach the remote shell as syntax. No shell session, file transfer
 * subsystem or forwarding is offered; a file is sent as a command's standard
 * input.
 */
export interface SshMediatedCredential extends MediatedCredentialBase {
  readonly kind: "ssh";
  /**
   * The server the handle is pinned to, as its provider origin names it. An
   * address is not secret, and a holder needs it to reach what the server
   * serves to everyone else, such as its web port.
   */
  readonly address: { readonly host: string; readonly port: number };
  exec(
    argv: readonly string[],
    options: SshExecOptions,
  ): Promise<SshExecResult>;
}

/**
 * A mediated credential handed to a consumer at resolve time. A discriminated
 * union on `kind`; `http` is the only variant today. Future provider kinds
 * (e.g. an ssh key-file + agent socket) extend the union with their own `kind`.
 * Builder adds `ssh` as such a kind; a consumer narrows on `kind` before use.
 */
export type MediatedCredential = HttpMediatedCredential | SshMediatedCredential;

/**
 * A provider plugin: the seam that owns how a mediated credential is shaped for
 * its provider. Registered under `key`, matched against a resolved provider's
 * plugin identifier. The plugin shapes a handle from a material source; it does
 * not acquire material and never decides authorization -- both happen upstream,
 * at the delivery boundary, before a plugin is ever consulted.
 */
export interface CredentialProvider {
  readonly key: string;
  shape(context: CredentialShapeContext): MediatedCredential;
}

/**
 * The runtime `credentials` capability: a sub-registry a consumer queries by
 * the credential handle it declared, receiving a mediated credential. It is the
 * dynamic (per-binding) axis that lives under the fixed, statically-typed
 * capability map.
 *
 * Resolution is consumer-scoped and fail-closed: it yields a handle only for a
 * credential the calling consumer is authorized to use. An unbound handle, or
 * one the consumer lacks a `credential:{id}` / `use` grant for, throws. `resolve`
 * is async because the authorization check is.
 */
export interface CredentialCapability {
  resolve(handle: string): Promise<MediatedCredential>;
}

/**
 * What `resolve` throws for a handle no binding resolves, as for an optional
 * credential that was not delivered, so a consumer that works without it can
 * tell that apart from a refusal.
 */
export class UnboundCredentialError extends Error {
  constructor(
    readonly handle: string,
    consumer: string,
  ) {
    super(`no credential is bound to handle "${handle}" for consumer ${consumer}`);
    this.name = "UnboundCredentialError";
  }
}

/**
 * Whether `error` is an `UnboundCredentialError`. It reads the error's name
 * rather than its class, because a consumer bundled with its own copy of this
 * package sees another class.
 */
export function isUnboundCredentialError(
  error: unknown,
): error is UnboundCredentialError {
  return error instanceof Error && error.name === "UnboundCredentialError";
}

/**
 * A `CredentialCapability` plus a host-only `dispose`. The consumer sees only
 * `resolve`; the host runs `dispose` on teardown to release every handle shaped
 * through this capability (an http handle holds nothing; a future key-file /
 * socket handle would).
 */
export interface HostCredentialCapability extends CredentialCapability {
  dispose(): Promise<void>;
}
