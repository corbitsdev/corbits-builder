import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { createServer } from "node:net";
import { createCredentialProviderRegistry } from "@intx/harness";
import { sidecarCredentialProviders } from "./substrate-factory";

// A loopback port nothing listens on: a handle allowed to reach it fails to
// connect, one that is not is refused before it tries.
async function closedLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("no port");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

const userKey = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
}).privateKey;

async function execOnLoopback(sshAllowPrivateAddresses: string | undefined) {
  const port = await closedLoopbackPort();
  const handle = createCredentialProviderRegistry(
    sidecarCredentialProviders(sshAllowPrivateAddresses),
  )
    .resolve("ssh")
    .shape({
      origin: `ssh://127.0.0.1:${port}`,
      readCurrentMaterial: () => ({
        secret: JSON.stringify({
          host: "127.0.0.1",
          port,
          user: "builder",
          privateKey: userKey,
          hostKey: `SHA256:${"A".repeat(43)}`,
        }),
      }),
    });
  if (handle.kind !== "ssh") throw new Error("not an ssh handle");
  return handle.exec(["true"], { timeoutMs: 5000 });
}

describe("sidecarCredentialProviders", () => {
  test("keeps an ssh credential off a loopback address when the operator left it off", async () => {
    await expect(execOnLoopback("false")).rejects.toMatchObject({
      failure: "address_refused",
    });
  });

  test("keeps an ssh credential off a loopback address when the config leaves the setting out", async () => {
    await expect(execOnLoopback(undefined)).rejects.toMatchObject({
      failure: "address_refused",
    });
  });

  test("lets an ssh credential reach a loopback address when the operator turned it on", async () => {
    await expect(execOnLoopback("true")).rejects.toMatchObject({
      failure: "unreachable",
    });
  });

  test("refuses a value the boot edge never writes", () => {
    expect(() => sidecarCredentialProviders("yes")).toThrow(
      "SIDECAR_SSH_ALLOW_PRIVATE_ADDRESSES",
    );
  });
});
