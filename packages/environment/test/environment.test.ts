import { expect, test } from "bun:test";
import { type } from "arktype";

import {
  environment,
  EnvironmentError,
  filled,
  flag,
  hexKey,
  list,
  origin,
  port,
  positiveInteger,
} from "../src/index.ts";
import { inherit } from "../src/inherit.ts";

const problems = (read: () => unknown) => {
  try {
    read();
  } catch (error) {
    if (error instanceof EnvironmentError) return error.problems;
    throw error;
  }
  throw new Error("The environment was accepted");
};

const read = environment(
  type({
    SECRET: "string >= 32",
    KEY: hexKey,
    PORT: port.default("8000"),
    "TIMEOUT_MS?": positiveInteger,
    "ORIGIN?": origin,
    "OWNER?": filled,
    ON: flag(true),
    "LIST?": list,
  }),
);

const valid = { SECRET: "s".repeat(32), KEY: "ab".repeat(32) };

test("every problem is reported at once, a missing variable as missing", () => {
  expect(problems(() => read({ PORT: "0", ON: "yes" }))).toEqual([
    "KEY must be a string (missing)",
    "SECRET must be a string (missing)",
    "ON must be true or false",
    "PORT must be an integer between 1 and 65535",
  ]);
});

test("an error never holds a value, nor a value's length", () => {
  const value = "leak-probe-Value-29-chars-xyz";
  const message = problems(() =>
    read(Object.fromEntries(read.variables.map(({ name }) => [name, value]))),
  ).join("\n");
  expect(message).not.toContain(value);
  expect(message).not.toContain(String(value.length));
});

test("the variables are listed, each required or not", () => {
  expect(read.variables).toEqual([
    { name: "KEY", required: true },
    { name: "LIST", required: false },
    { name: "ON", required: false },
    { name: "ORIGIN", required: false },
    { name: "OWNER", required: false },
    { name: "PORT", required: false },
    { name: "SECRET", required: true },
    { name: "TIMEOUT_MS", required: false },
  ]);
});

test("each piece reads its variable and refuses what it cannot", () => {
  expect(read({ ...valid, UNLISTED: "x" })).toEqual({
    ...valid,
    PORT: 8000,
    ON: true,
  });
  expect(
    read({
      ...valid,
      PORT: "8443",
      TIMEOUT_MS: "60000",
      ORIGIN: "https://builder.example/",
      OWNER: "someone",
      ON: "false",
      LIST: " a, ,b ",
    }),
  ).toEqual({
    ...valid,
    PORT: 8443,
    TIMEOUT_MS: 60000,
    ORIGIN: "https://builder.example",
    OWNER: "someone",
    ON: false,
    LIST: ["a", "b"],
  });
  expect(read({ ...valid, ON: "" }).ON).toBe(true);
  for (const [name, value] of [
    ["KEY", "ab".repeat(31)],
    ["TIMEOUT_MS", "0"],
    ["TIMEOUT_MS", "1.5"],
    ["PORT", "65536"],
    ["ORIGIN", "ftp://builder.example"],
    ["ORIGIN", "https://user:pass@builder.example"],
    ["ORIGIN", "https://builder.example/path"],
    ["ORIGIN", "https://builder.example/?q"],
    ["ORIGIN", "not a url"],
    ["OWNER", "  "],
  ])
    expect(problems(() => read({ ...valid, [name!]: value }))).toHaveLength(1);
});

test("a rule across variables runs once each is valid, and what is derived joins the result", () => {
  const range = environment(type({ FROM: port, TO: port }), {
    problems: ({ FROM, TO }) =>
      FROM <= TO ? [] : [{ variable: "TO", expected: "at least FROM" }],
    derive: ({ FROM, TO }) => ({ size: TO - FROM + 1 }),
  });
  expect(range({ FROM: "10", TO: "12", OTHER: "x" })).toEqual({
    FROM: 10,
    TO: 12,
    size: 3,
  });
  expect(problems(() => range({ FROM: "12", TO: "10" }))).toEqual([
    "TO must be at least FROM",
  ]);
  expect(problems(() => range({ FROM: "0", TO: "10" }))).toEqual([
    "FROM must be an integer between 1 and 65535",
  ]);
});

test("a child inherits only the named variables that are set", () => {
  expect(
    inherit(["PATH", "HOME", "TMPDIR"], {
      PATH: "/bin",
      HOME: "",
      SECRET: "x",
    }),
  ).toEqual({ PATH: "/bin" });
});
