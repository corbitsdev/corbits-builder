import { expect, test } from "bun:test";
import { readServerAddress } from "./server-key.ts";

test.each([
  ["203.0.113.5", { host: "203.0.113.5", port: 22 }],
  [" server.example.com:2222 ", { host: "server.example.com", port: 2222 }],
  ["2001:db8::5", { host: "2001:db8::5", port: 22 }],
  ["[2001:db8::5]:2200", { host: "2001:db8::5", port: 2200 }],
])("reads %p as a server", (typed, server) => {
  expect(readServerAddress(typed)).toEqual(server);
});

test.each([
  "",
  "root@203.0.113.5",
  "https://example.com",
  "example.com:0",
  "example.com:ssh",
  "two words",
])("reads %p as no server", (typed) => {
  expect(readServerAddress(typed)).toBeUndefined();
});
