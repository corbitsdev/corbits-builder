import { expect, test } from "bun:test";
import { signInCallback } from "./sign-ins.ts";

test("the callback address keeps the path a hub is served under", () => {
  expect(signInCallback(new URL("https://builder.example"))).toBe(
    "https://builder.example/api/oauth/callback",
  );
  expect(signInCallback(new URL("https://example.com/builder"))).toBe(
    "https://example.com/builder/api/oauth/callback",
  );
  expect(signInCallback(new URL("https://example.com/builder/"))).toBe(
    "https://example.com/builder/api/oauth/callback",
  );
});
