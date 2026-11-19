import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { sshCredentialFailure } from "@intx/types";
import { Server, utils } from "ssh2";
import {
  createSshCredentialProvider,
  isDeniedSshAddress,
  readSshHostKey,
  sshAddressOf,
  sshOrigin,
} from "./ssh-credential-provider";

const hostKeys = utils.generateKeyPairSync("ed25519");
const otherHostKeys = utils.generateKeyPairSync("ed25519");
const userKeys = utils.generateKeyPairSync("ed25519");
const strangerKeys = utils.generateKeyPairSync("ed25519");

function fingerprintOf(publicKey: string) {
  const parsed = utils.parseKey(publicKey);
  if (parsed instanceof Error) throw parsed;
  return (
    "SHA256:" +
    createHash("sha256")
      .update(parsed.getPublicSSH())
      .digest("base64")
      .replace(/=+$/, "")
  );
}

// A server that accepts the user's key and answers a few commands itself, so
// the handle's behaviour is observed over a real SSH connection.
function startServer(hostKey: string) {
  const authorized = utils.parseKey(userKeys.public);
  if (authorized instanceof Error) throw authorized;
  const seen = {
    commands: [] as string[],
    authAttempts: 0,
    // What reached each 'hang' command before its session closed.
    hangs: [] as { signals: string[]; closed: boolean }[],
  };
  // ssh2's server drops every channel request once a session's input has
  // ended, as every command here ends it, so a signal request is seen where it
  // arrives on the wire, and counted against the command still hanging.
  const debug = (message: string) => {
    const signal = /CHANNEL_REQUEST \(r:\d+, signal: (\w+)\)/.exec(message);
    const hang = seen.hangs.at(-1);
    if (signal && hang && !hang.closed) hang.signals.push(signal[1]!);
  };
  const server = new Server({ hostKeys: [hostKey], debug }, (client) => {
    client.on("error", () => {});
    client.on("authentication", (context) => {
      seen.authAttempts++;
      if (
        context.method === "publickey" &&
        context.key.data.equals(authorized.getPublicSSH())
      )
        context.accept();
      else context.reject(["publickey"]);
    });
    client.on("ready", () => {
      client.on("session", (accept) => {
        accept().on("exec", (acceptExec, _reject, info) => {
          const stream = acceptExec();
          seen.commands.push(info.command);
          if (info.command === "'hang'") {
            // Like a server that ignores signal requests: the command runs on
            // until its session is closed.
            const hang = { signals: [] as string[], closed: false };
            seen.hangs.push(hang);
            stream.on("close", () => (hang.closed = true));
            stream.resume();
          }
          if (info.command === "'count'") {
            let bytes = 0;
            stream.on("data", (chunk: Buffer) => (bytes += chunk.length));
            stream.on("end", () => {
              stream.write(String(bytes));
              stream.exit(0);
              stream.end();
            });
          } else if (info.command === "'fail'") {
            stream.stderr.write("it broke");
            stream.exit(7);
            stream.end();
          } else if (info.command === "'flood'") {
            stream.write(Buffer.alloc(5000, "a"));
            stream.exit(0);
            stream.end();
          } else if (info.command !== "'hang'") {
            stream.write("ran");
            stream.exit(0);
            stream.end();
          }
        });
      });
    });
  });
  return new Promise<{ port: number; seen: typeof seen; close(): void }>(
    (resolve) =>
      server.listen(0, "127.0.0.1", () =>
        resolve({
          port: (server.address() as AddressInfo).port,
          seen,
          close: () => server.close(),
        }),
      ),
  );
}

let server: Awaited<ReturnType<typeof startServer>>;
beforeAll(async () => {
  server = await startServer(hostKeys.private);
});
afterAll(() => server.close());

function credential(
  overrides: Partial<{
    origin: string;
    host: string;
    port: number;
    privateKey: string;
    hostKey: string;
    allowPrivateAddresses: boolean;
    lookup: (host: string) => Promise<{ address: string; family: number }[]>;
  }> = {},
) {
  let reads = 0;
  const handle = createSshCredentialProvider({
    allowPrivateAddresses: overrides.allowPrivateAddresses ?? true,
    ...(overrides.lookup !== undefined ? { lookup: overrides.lookup } : {}),
  }).shape({
    origin: overrides.origin ?? sshOrigin("127.0.0.1", server.port),
    readCurrentMaterial: () => {
      reads++;
      return {
        secret: JSON.stringify({
          host: overrides.host ?? "127.0.0.1",
          port: overrides.port ?? server.port,
          user: "builder",
          privateKey: overrides.privateKey ?? userKeys.private,
          hostKey: overrides.hostKey ?? fingerprintOf(hostKeys.public),
        }),
      };
    },
  });
  if (handle.kind !== "ssh") throw new Error("not an ssh handle");
  return { handle, reads: () => reads };
}

// The latest 'hang' command as the server saw it once its session closed, or
// as it stood after half a second, well inside the handle's grace for a close.
async function lastHangStopped() {
  const hang = server.seen.hangs.at(-1);
  for (let waited = 0; hang?.closed === false && waited < 500; waited += 20)
    await Bun.sleep(20);
  return hang;
}

describe("createSshCredentialProvider", () => {
  test("runs a command and returns its output and exit status", async () => {
    const { handle } = credential();
    expect(await handle.exec(["run"], { timeoutMs: 5000 })).toEqual({
      code: 0,
      stdout: "ran",
      stderr: "",
      truncated: false,
    });
    expect(await handle.exec(["fail"], { timeoutMs: 5000 })).toMatchObject({
      code: 7,
      stderr: "it broke",
    });
  });

  test("names the server it is pinned to without reading the secret", () => {
    const provider = createSshCredentialProvider();
    const shape = (origin: string) => {
      const handle = provider.shape({
        origin,
        readCurrentMaterial: () => {
          throw new Error("the address is read from the origin alone");
        },
      });
      if (handle.kind !== "ssh") throw new Error("not an ssh handle");
      return handle.address;
    };
    expect(shape("ssh://Server.Example:2222")).toEqual({
      host: "server.example",
      port: 2222,
    });
    expect(shape("ssh://[2606:4700::1111]")).toEqual({
      host: "2606:4700::1111",
      port: 22,
    });
    expect(() => shape("https://server.example")).toThrow("invalid_origin");
  });

  test("quotes each argument so none reaches the remote shell as syntax", async () => {
    const { handle } = credential();
    await handle.exec(["echo", "a b", "it's; rm -rf /", "$(id)"], {
      timeoutMs: 5000,
    });
    expect(server.seen.commands.at(-1)).toBe(
      `'echo' 'a b' 'it'\\''s; rm -rf /' '$(id)'`,
    );
  });

  test("sends standard input and closes it", async () => {
    const { handle } = credential();
    const result = await handle.exec(["count"], {
      stdin: new Uint8Array(300_000),
      timeoutMs: 5000,
    });
    expect(result.stdout).toBe("300000");
  });

  test("cuts output past the cap and says so", async () => {
    const { handle } = credential();
    const result = await handle.exec(["flood"], {
      timeoutMs: 5000,
      maxOutputBytes: 100,
    });
    expect(result.stdout).toHaveLength(100);
    expect(result.truncated).toBe(true);
  });

  test("refuses a server presenting another host key before signing in", async () => {
    const impostor = await startServer(otherHostKeys.private);
    try {
      const { handle } = credential({
        origin: sshOrigin("127.0.0.1", impostor.port),
        port: impostor.port,
      });
      expect(handle.exec(["run"], { timeoutMs: 5000 })).rejects.toMatchObject({
        failure: "host_key_changed",
      });
      await handle.exec(["run"], { timeoutMs: 5000 }).catch(() => {});
      expect(impostor.seen.authAttempts).toBe(0);
      expect(impostor.seen.commands).toEqual([]);
    } finally {
      impostor.close();
    }
  });

  test("refuses a key the server does not accept", async () => {
    const { handle } = credential({ privateKey: strangerKeys.private });
    expect(handle.exec(["run"], { timeoutMs: 5000 })).rejects.toMatchObject({
      failure: "auth_failed",
    });
  });

  test("refuses when the secret was saved for another address than the origin", async () => {
    const before = server.seen.authAttempts;
    for (const overrides of [{ host: "198.51.100.7" }, { port: 2200 }]) {
      const { handle } = credential(overrides);
      expect(handle.exec(["run"], { timeoutMs: 5000 })).rejects.toMatchObject({
        failure: "address_mismatch",
      });
    }
    expect(server.seen.authAttempts).toBe(before);
  });

  test("refuses private addresses unless the host allows them", async () => {
    const { handle } = credential({ allowPrivateAddresses: false });
    expect(handle.exec(["run"], { timeoutMs: 5000 })).rejects.toMatchObject({
      failure: "address_refused",
    });
  });

  test("refuses a name that resolves to any private address", async () => {
    const { handle } = credential({
      origin: "ssh://server.example:22",
      host: "server.example",
      port: 22,
      allowPrivateAddresses: false,
      lookup: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.5", family: 4 },
      ],
    });
    expect(handle.exec(["run"], { timeoutMs: 5000 })).rejects.toMatchObject({
      failure: "address_refused",
    });
  });

  test("stops a command when its caller aborts, and never connects once aborted", async () => {
    const { handle } = credential();
    const controller = new AbortController();
    const running = handle.exec(["hang"], {
      timeoutMs: 5000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 200);
    expect(running).rejects.toMatchObject({ failure: "cancelled" });
    await running.catch(() => {});
    expect(await lastHangStopped()).toEqual({
      signals: ["KILL"],
      closed: true,
    });

    const before = server.seen.authAttempts;
    expect(
      handle.exec(["run"], { timeoutMs: 5000, signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ failure: "cancelled" });
    await handle
      .exec(["run"], { timeoutMs: 5000, signal: AbortSignal.abort() })
      .catch(() => {});
    expect(server.seen.authAttempts).toBe(before);
  });

  test("stops a command that outlives its timeout", async () => {
    const { handle } = credential();
    const running = handle.exec(["hang"], { timeoutMs: 300 });
    expect(running).rejects.toMatchObject({ failure: "timeout" });
    await running.catch(() => {});
    expect(await lastHangStopped()).toEqual({
      signals: ["KILL"],
      closed: true,
    });
  });

  test("reads the secret again for every command", async () => {
    const { handle, reads } = credential();
    await handle.exec(["run"], { timeoutMs: 5000 });
    await handle.exec(["run"], { timeoutMs: 5000 });
    expect(reads()).toBe(2);
  });

  test("keeps the secret out of an invalid-secret error", async () => {
    const handle = createSshCredentialProvider().shape({
      origin: "ssh://203.0.113.9:22",
      readCurrentMaterial: () => ({ secret: "PRIVATE-KEY-MATERIAL" }),
    });
    if (handle.kind !== "ssh") throw new Error("not an ssh handle");
    const error = await handle
      .exec(["run"], { timeoutMs: 5000 })
      .catch((caught: unknown) => caught);
    expect(String(error)).toBe(
      "SshCredentialError: ssh credential: invalid_secret",
    );
    expect(sshCredentialFailure(error)).toBe("invalid_secret");
  });

  test("names no failure for an error a handle did not throw", () => {
    for (const error of [
      new Error("ssh credential: timeout"),
      Object.assign(new Error("x"), { failure: "timeout" }),
      { name: "SshCredentialError", failure: "timeout" },
    ])
      expect(sshCredentialFailure(error)).toBeUndefined();
  });
});

describe("sshAddressOf", () => {
  test("reads the server an origin names, as a handle pins to it", () => {
    expect(sshAddressOf("ssh://Server.Example.COM:2222")).toEqual({
      host: "server.example.com",
      port: 2222,
    });
    expect(sshAddressOf("ssh://[2001:0db8:0:0::5]")).toEqual({
      host: "2001:db8::5",
      port: 22,
    });
    expect(sshAddressOf(sshOrigin("2606:4700::1111", 2200))).toEqual({
      host: "2606:4700::1111",
      port: 2200,
    });
  });

  test("refuses anything but a bare ssh origin", () => {
    for (const origin of [
      "https://server.example",
      "ssh://root@server.example",
      "ssh://server.example/path",
      "not an origin",
    ])
      expect(() => sshAddressOf(origin)).toThrow("invalid_origin");
  });
});

describe("readSshHostKey", () => {
  test("returns the fingerprint the server presents without signing in", async () => {
    const before = server.seen.authAttempts;
    expect(
      await readSshHostKey("127.0.0.1", server.port, {
        allowPrivateAddresses: true,
      }),
    ).toBe(fingerprintOf(hostKeys.public));
    expect(server.seen.authAttempts).toBe(before);
  });

  test("refuses private addresses unless the host allows them", async () => {
    expect(readSshHostKey("127.0.0.1", server.port)).rejects.toMatchObject({
      failure: "address_refused",
    });
  });
});

describe("isDeniedSshAddress", () => {
  test("refuses addresses that are never a rented server", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.1.1",
      "100.64.0.1",
      "169.254.169.254",
      "0.0.0.0",
      "::1",
      "fd00:ec2::254",
      "fe80::1",
      "::ffff:10.0.0.1",
      "::127.0.0.1",
      "::a9fe:a9fe",
      "64:ff9b::a00:1",
      "64:ff9b:1::a00:1",
      "100::1",
      "2001:0:4136:e378:8000:63bf:3fff:fdd2",
      "2002:7f00:1::1",
      "fec0::1",
      "192.88.99.1",
      "not-an-address",
    ])
      expect([address, isDeniedSshAddress(address)]).toEqual([address, true]);
  });

  test("allows public addresses", () => {
    for (const address of [
      "93.184.216.34",
      "172.32.0.1",
      "8.8.8.8",
      "2606:4700::1111",
      "2001:4860:4860::8888",
      "2a00:1450:4001:80b::200e",
    ])
      expect([address, isDeniedSshAddress(address)]).toEqual([address, false]);
  });
});
