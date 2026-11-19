import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { sshCredentialFailure } from "@intx/types";
import { Server, utils } from "ssh2";
import {
  createSshCredentialProvider,
  isDeniedSshAddress,
  sshOrigin,
} from "./ssh-credential-provider";

const hostKeys = utils.generateKeyPairSync("ed25519");
const userKeys = utils.generateKeyPairSync("ed25519");

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

function credential() {
  let reads = 0;
  const handle = createSshCredentialProvider({
    allowPrivateAddresses: true,
  }).shape({
    origin: sshOrigin("127.0.0.1", server.port),
    readCurrentMaterial: () => {
      reads++;
      return {
        secret: JSON.stringify({
          host: "127.0.0.1",
          port: server.port,
          user: "builder",
          privateKey: userKeys.private,
          hostKey: fingerprintOf(hostKeys.public),
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
});

describe("isDeniedSshAddress", () => {
  test("refuses addresses that are never a rented server, and allows public ones", () => {
    const denied = [
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
    ];
    const allowed = [
      "93.184.216.34",
      "172.32.0.1",
      "8.8.8.8",
      "2606:4700::1111",
      "2001:4860:4860::8888",
      "2a00:1450:4001:80b::200e",
    ];
    for (const address of [...denied, ...allowed])
      expect([address, isDeniedSshAddress(address)]).toEqual([
        address,
        denied.includes(address),
      ]);
  });
});
