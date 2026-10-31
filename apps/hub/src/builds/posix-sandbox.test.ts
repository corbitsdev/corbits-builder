import { expect, test } from "bun:test";
import { publicHostName } from "./posix-sandbox.ts";

test("the open network admits only public names, however a private address is spelled", () => {
  for (const host of [
    "127.0.0.1",
    "127.1",
    "2130706433",
    "0x7f.0.0.1",
    "0177.0.0.1",
    "127.0.0.1.",
    "10.1",
    "2852039166",
    "169.254.169.254",
    "[::1]",
    "::1",
    "[::ffff:127.0.0.1]",
    "localhost",
    "LOCALHOST.",
    "hub.localhost",
    "",
  ])
    expect([host, publicHostName(host)]).toEqual([host, false]);
  for (const host of [
    "registry.npmjs.org",
    "api.open-meteo.com",
    "Example.COM.",
  ])
    expect([host, publicHostName(host)]).toEqual([host, true]);
});
