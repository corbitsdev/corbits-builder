import { describe, expect, test } from "bun:test";
import "./plugin-roles.testing.ts";
import { screenWords } from "./roles.ts";

describe("a screen's words", () => {
  test("say when the screen asks the person to accept something, so typed words ask for changes", () => {
    expect(screenWords("writer", "approve")?.decides).toBe(true);
    expect(screenWords("designer", "looks")?.decides).toBe(false);
  });
});
