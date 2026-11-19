/// <reference path="./ssh2.d.ts" />
// The built-in SSH credential provider: it shapes a resolved credential into a
// handle that runs one command at a time on the one server the credential was
// saved for. It sits beside the http providers and follows the same rules: the
// material is read fresh on every use, the handle is pinned to the provider
// origin, and no diagnostic carries the secret.
//
// Three checks are load-bearing security and live in the handle, not with the
// caller:
//
//  - Address. The origin is `ssh://host:port`. The secret repeats the host and
//    port it was saved for, and the handle refuses when they differ, so a
//    provider row edited to point elsewhere cannot carry the key there.
//  - Reachability. The host is resolved once, every address it resolves to is
//    checked against a deny list (loopback, private, link-local and the other
//    ranges that are never a rented server), and the connection is made to the
//    address that was checked, so a second resolution cannot swap it.
//  - Host key. The secret holds the fingerprint the server presented when the
//    credential was saved. A server presenting another key is refused during
//    the handshake, before authentication.

import { createHash, timingSafeEqual } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import type {
  CredentialProvider,
  CredentialShapeContext,
  SshCredentialFailure,
  SshExecOptions,
  SshExecResult,
  SshMediatedCredential,
} from "@intx/types";
import { type } from "arktype";
import { Client, type ClientChannel } from "ssh2";

export type { SshCredentialFailure };

/**
 * The one error an ssh handle throws. Its message is the failure code alone:
 * a server's banner, a parser's diagnostic or a key library's error can each
 * carry material, so none of them is passed on.
 */
export class SshCredentialError extends Error {
  constructor(readonly failure: SshCredentialFailure) {
    super(`ssh credential: ${failure}`);
    this.name = "SshCredentialError";
  }
}

/** Resolves a host name to every address it has. */
export type SshLookup = (
  host: string,
) => Promise<readonly { address: string; family: number }[]>;

/** Options for the built-in SSH provider. */
export interface SshCredentialProviderOptions {
  /**
   * Lets a handle connect to loopback and private addresses. Off unless a host
   * turns it on: for development against a local server, or for an operator
   * whose servers sit on a private network.
   */
  allowPrivateAddresses?: boolean;
  /** Defaults to the system resolver; injectable so a test needs no network. */
  lookup?: SshLookup;
}

const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const HANDSHAKE_TIMEOUT_MS = 20_000;
const STOP_GRACE_MS = 1_000;

// Addresses that are never a server a person rented: this machine, private and
// carrier networks, link-local and site-local (link-local holds the cloud
// metadata endpoints), documentation, benchmarking, relays, discard-only,
// multicast and reserved space. Every range that embeds an IPv4 address in
// IPv6 (IPv4-compatible, IPv4-mapped, NAT64, 6to4 and Teredo) is refused whole,
// because the embedded address would bypass the IPv4 rules.
// Two lists, because a BlockList matches an IPv4 address against an IPv6 rule
// for its mapped form, which would refuse every IPv4 address.
const deniedIpv4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  deniedIpv4.addSubnet(network, prefix, "ipv4");
const deniedIpv6 = new BlockList();
for (const [network, prefix] of [
  ["::", 96],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 32],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const)
  deniedIpv6.addSubnet(network, prefix, "ipv6");

/** Whether `address` is one an ssh handle refuses to connect to. */
export function isDeniedSshAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return deniedIpv4.check(address, "ipv4");
  if (family === 6) return deniedIpv6.check(address, "ipv6");
  return true;
}

const HostKey = /^SHA256:[A-Za-z0-9+/]{43}$/;

const secretShape = type({
  "+": "reject",
  host: "string > 0",
  port: "1 <= number.integer <= 65535",
  user: /^[a-z_][a-z0-9_-]{0,31}$/,
  privateKey: "string > 0",
  hostKey: HostKey,
});

/** The server an origin names. */
export interface SshAddress {
  readonly host: string;
  readonly port: number;
}

/**
 * The server an `ssh://host:port` origin names, as a handle pins to it: the
 * host lowercased and without an IPv6 literal's brackets, and port 22 when the
 * origin names none. Throws `invalid_origin` for anything else.
 */
// `new URL("ssh://host").origin` is the string "null" for a non-special
// scheme, so the parts are read and compared one by one.
export function sshAddressOf(origin: string): SshAddress {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new SshCredentialError("invalid_origin");
  }
  if (
    url.protocol !== "ssh:" ||
    url.hostname === "" ||
    url.username !== "" ||
    url.password !== "" ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.search !== "" ||
    url.hash !== ""
  )
    throw new SshCredentialError("invalid_origin");
  // A bracketed IPv6 literal keeps its brackets in `hostname`.
  const host = url.hostname.replace(/^\[(.*)\]$/, "$1").toLowerCase();
  return { host, port: url.port === "" ? 22 : Number(url.port) };
}

/** The origin an ssh credential's provider is saved with for `host` and `port`. */
export function sshOrigin(host: string, port = 22): string {
  const name = isIP(host) === 6 ? `[${host}]` : host;
  return `ssh://${name}:${port}`;
}

async function checkedAddress(
  target: SshAddress,
  options: SshCredentialProviderOptions,
): Promise<string> {
  let addresses: readonly { address: string }[];
  if (isIP(target.host) !== 0) addresses = [{ address: target.host }];
  else {
    try {
      addresses = await (options.lookup ?? systemLookup)(target.host);
    } catch {
      throw new SshCredentialError("unreachable");
    }
  }
  const first = addresses[0];
  if (first === undefined) throw new SshCredentialError("unreachable");
  // One denied address refuses the name: a name that answers with both a
  // public and a private address is not one to pick from.
  if (
    options.allowPrivateAddresses !== true &&
    addresses.some(({ address }) => isDeniedSshAddress(address))
  )
    throw new SshCredentialError("address_refused");
  return first.address;
}

const systemLookup: SshLookup = (host) => dnsLookup(host, { all: true });

function fingerprint(key: Buffer): string {
  return (
    "SHA256:" +
    createHash("sha256").update(key).digest("base64").replace(/=+$/, "")
  );
}

function sameFingerprint(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// Each argument single-quoted for a POSIX shell, which is what sshd hands the
// command to. Inside single quotes nothing is special but the quote itself.
function quote(argv: readonly string[]): string {
  if (argv.length === 0 || argv.some((arg) => arg.includes("\0")))
    throw new SshCredentialError("invalid_command");
  return argv.map((arg) => `'${arg.replaceAll("'", `'\\''`)}'`).join(" ");
}

/**
 * Read the host key the server at `host`:`port` presents, without signing in:
 * the fingerprint a credential for that server is then saved with. The same
 * address rules apply as for a handle.
 */
export async function readSshHostKey(
  host: string,
  port: number,
  options: SshCredentialProviderOptions = {},
): Promise<string> {
  const target = sshAddressOf(sshOrigin(host, port));
  const address = await checkedAddress(target, options);
  return new Promise<string>((resolve, reject) => {
    const client = new Client();
    let seen: string | undefined;
    client.on("error", () => {
      client.destroy();
      if (seen === undefined) reject(new SshCredentialError("unreachable"));
      else resolve(seen);
    });
    client.connect({
      host: address,
      port: target.port,
      // Never offered: the verifier ends the handshake before authentication.
      username: "none",
      readyTimeout: HANDSHAKE_TIMEOUT_MS,
      hostVerifier: (key: Buffer) => {
        seen = fingerprint(key);
        return false;
      },
    });
  });
}

/**
 * The built-in SSH credential provider. It shapes an `SshMediatedCredential`
 * from a JSON secret holding the server's address, the user, the private key
 * and the server's host key fingerprint. Each `exec` opens its own connection
 * and closes it, so a rotation or a revoke takes effect on the next call and
 * the handle holds nothing between calls.
 */
export function createSshCredentialProvider(
  options: SshCredentialProviderOptions = {},
): CredentialProvider {
  return {
    key: "ssh",
    shape(context: CredentialShapeContext): SshMediatedCredential {
      const pinned = sshAddressOf(context.origin);
      return {
        kind: "ssh",
        address: { host: pinned.host, port: pinned.port },
        async exec(
          argv: readonly string[],
          execOptions: SshExecOptions,
        ): Promise<SshExecResult> {
          const command = quote(argv);

          const { secret } = context.readCurrentMaterial();
          let parsed: unknown;
          try {
            parsed = JSON.parse(secret);
          } catch {
            // Parser diagnostics can contain secret material.
            throw new SshCredentialError("invalid_secret");
          }
          const material = secretShape(parsed);
          if (material instanceof type.errors)
            throw new SshCredentialError("invalid_secret");
          if (
            material.host.toLowerCase() !== pinned.host ||
            material.port !== pinned.port
          )
            throw new SshCredentialError("address_mismatch");

          const address = await checkedAddress(pinned, options);
          if (execOptions.signal?.aborted === true)
            throw new SshCredentialError("cancelled");
          return run(address, pinned.port, material, command, execOptions);
        },
        dispose(): void {
          // Each exec closes its own connection; nothing is held between calls.
        },
      };
    },
  };
}

function run(
  address: string,
  port: number,
  material: typeof secretShape.infer,
  command: string,
  options: SshExecOptions,
): Promise<SshExecResult> {
  const cap = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  return new Promise<SshExecResult>((resolve, reject) => {
    const client = new Client();
    let settled = false;
    let hostKeyRefused = false;
    const settle = (outcome: SshExecResult | SshCredentialFailure) => {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", cancel);
      if (typeof outcome === "string") reject(new SshCredentialError(outcome));
      else resolve(outcome);
      return true;
    };
    const finish = (outcome: SshExecResult | SshCredentialFailure) => {
      if (settle(outcome)) client.destroy();
    };
    let channel: ClientChannel | undefined;
    // A running command is asked to stop in the only two ways SSH has: a KILL
    // signal request, then closing its session. Both are messages on the
    // connection, so the connection stays up until the server closes the
    // session or a short grace passes. Neither is a promise: OpenSSH before
    // 7.9 ignores signal requests and many servers refuse them, and a closed
    // session ends a command only once it writes to its closed output or its
    // shell hangs it up. The call rejects at once either way.
    const stop = (failure: "cancelled" | "timeout") => {
      const running = channel;
      if (running === undefined) return finish(failure);
      if (!settle(failure)) return;
      const grace = setTimeout(() => client.destroy(), STOP_GRACE_MS);
      running.once("close", () => {
        clearTimeout(grace);
        client.destroy();
      });
      signalRequest(running, "KILL");
      running.close();
    };
    const timer = setTimeout(() => stop("timeout"), options.timeoutMs);
    const cancel = () => stop("cancelled");
    options.signal?.addEventListener("abort", cancel, { once: true });

    client.on("error", (error: Error & { level?: string }) => {
      if (hostKeyRefused) finish("host_key_changed");
      else if (error.level === "client-authentication") finish("auth_failed");
      else finish("unreachable");
    });
    client.on("close", () => finish("unreachable"));
    client.on("ready", () => {
      client.exec(command, (error, stream) => {
        if (error) return finish("unreachable");
        channel = stream;
        const out = collector(cap);
        const err = collector(cap);
        stream.on("data", out.add);
        stream.stderr.on("data", err.add);
        stream.on("close", (code: number | null) =>
          finish({
            code: code ?? null,
            stdout: out.text(),
            stderr: err.text(),
            truncated: out.truncated() || err.truncated(),
          }),
        );
        stream.end(options.stdin);
      });
    });

    try {
      client.connect({
        host: address,
        port,
        username: material.user,
        privateKey: material.privateKey,
        readyTimeout: Math.min(HANDSHAKE_TIMEOUT_MS, options.timeoutMs),
        hostVerifier: (key: Buffer) => {
          const matches = sameFingerprint(fingerprint(key), material.hostKey);
          hostKeyRefused = !matches;
          return matches;
        },
      });
    } catch {
      // The key library rejects an unreadable private key here, and its
      // message can quote the key.
      finish("invalid_secret");
    }
  });
}

// Keeps the first `cap` bytes of a stream and counts the rest as dropped; the
// stream keeps draining so the remote command is never blocked on a full pipe.
function collector(cap: number) {
  const chunks: Buffer[] = [];
  let kept = 0;
  let dropped = false;
  return {
    add(chunk: Buffer) {
      const room = cap - kept;
      if (chunk.length > room) dropped = true;
      if (room <= 0) return;
      const part = chunk.length > room ? chunk.subarray(0, room) : chunk;
      chunks.push(part);
      kept += part.length;
    },
    text: () => Buffer.concat(chunks).toString("utf8"),
    truncated: () => dropped,
  };
}

// What ssh2 keeps on a channel that a signal request is written with, in the
// ssh2 version this package pins.
type ChannelInternals = {
  outgoing: { id: number; state: string };
  _client: { _protocol: { signal(id: number, name: string): void } };
};

// ssh2's own channel.signal() sends nothing once standard input is closed,
// and every command here has its input closed as it starts. SSH takes a signal
// request on a channel until the channel is closed (RFC 4254, 6.9), so the
// request is written through ssh2's protocol layer, as channel.signal() writes
// it while input is open.
function signalRequest(channel: ClientChannel, name: string) {
  const { outgoing, _client } = channel as unknown as ChannelInternals;
  if (outgoing.state === "open" || outgoing.state === "eof")
    _client._protocol.signal(outgoing.id, name);
}
