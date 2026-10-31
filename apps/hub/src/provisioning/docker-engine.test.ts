import { expect, test } from "bun:test";
import { connectDocker, DockerEngineError } from "./docker-engine.ts";

test("Docker transport refuses credential URLs and cleartext remote daemons", () => {
  expect(() => connectDocker("tcp://operator:secret@localhost:2375")).toThrow(
    "must not contain credentials",
  );
  expect(() => connectDocker("tcp://daemon.example.invalid:2375")).toThrow(
    "explicit TLS",
  );
  expect(() => connectDocker("https://localhost:2376")).toThrow(
    "must be unix:// or tcp://",
  );
});

test("actual daemon HTTP failure preserves status without credential-bearing response bodies", async () => {
  const secret = crypto.randomUUID();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => Response.json({ detail: secret }, { status: 409 }),
  });
  try {
    const engine = connectDocker(`tcp://127.0.0.1:${server.port}`);
    let refusal: unknown;
    try {
      await engine.request("POST", "/containers/owned/start");
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(DockerEngineError);
    expect((refusal as DockerEngineError).status).toBe(409);
    expect(String(refusal)).not.toContain(secret);
    expect(String(refusal)).toContain("/containers/owned/start");
  } finally {
    await server.stop(true);
  }
});
