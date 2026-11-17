import { expect, test } from "bun:test";
import { greeting } from "./index.ts";

test("greets the world when no one is named", () => {
  expect(greeting()).toBe("Hello, world!");
});

test("greets the name it is given", () => {
  expect(greeting("Ada")).toBe("Hello, Ada!");
});
