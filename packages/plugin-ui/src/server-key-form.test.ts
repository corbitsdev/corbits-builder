import { afterEach, beforeEach, expect, test } from "bun:test";
import { interchange } from "./interchange-stub.testing.ts";
import {
  connectServerKey,
  heldServerKey,
  issueServerKey,
} from "./server-key-form.tsx";

let stub: ReturnType<typeof interchange>;
beforeEach(() => {
  stub = interchange();
});
afterEach(() => stub.restore());

const toHub = () =>
  stub.sent.filter(({ path }) => path.includes("/server-keys/"));

test("the form's opening read never makes a key, and a project with none reads as none", async () => {
  expect(await heldServerKey("p1", "server")).toBeUndefined();
  expect(toHub().map(({ method }) => method)).toEqual(["GET"]);
});

test("a new key is asked for as fresh", async () => {
  await issueServerKey("p1", "server", { fresh: true });
  expect(toHub()).toMatchObject([
    {
      method: "POST",
      path: "/api/tenants/p1/server-keys/server/key",
      body: { fresh: true },
    },
  ]);
});

test("the server's address goes to the hub as the person typed it", async () => {
  await connectServerKey("p1", "server", {
    host: "server.example.com",
    port: 2222,
  });
  expect(toHub().at(-1)).toMatchObject({
    method: "POST",
    path: "/api/tenants/p1/server-keys/server/bind",
    body: { host: "server.example.com", port: 2222 },
  });
});

test("a server the hub could not connect is refused with the hub's own code", async () => {
  stub.serverKeys.refusal = { status: 502, code: "server_refused_key" };
  await expect(
    connectServerKey("p1", "server", { host: "203.0.113.5", port: 22 }),
  ).rejects.toThrow("server_refused_key");
});
