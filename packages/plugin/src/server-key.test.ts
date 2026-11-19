import { expect, test } from "bun:test";
import { generateServerKey } from "./server-key.ts";

// That an SSH server signs in the private key with this public line is proven against a real server
// in test/e2e/server-key.test.ts.
test("the public line a person gives their host names an ed25519 key and the key's name", async () => {
  const { publicKey } = await generateServerKey("builder-abc");
  const [type, blob, comment] = publicKey.split(" ");
  expect(type).toBe("ssh-ed25519");
  expect(blob).toMatch(/^AAAAC3NzaC1lZDI1NTE5[A-Za-z0-9+/]+=*$/);
  expect(comment).toBe("builder-abc");
});

test("each key pair is new", async () => {
  const [one, two] = await Promise.all([
    generateServerKey("builder-abc"),
    generateServerKey("builder-abc"),
  ]);
  expect(one.publicKey).not.toBe(two.publicKey);
});
