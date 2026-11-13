import { describe, expect, test } from "bun:test";
import { checkInput, guidanceText } from "@corbits-builder/plugin";
import manifest from "../../package.json";
import screen from "./screen.ts";

// What the hub reads from a design whose primary is orange on white.
const project = {
  "look.color-primary": "#e98428",
  "look.color-background": "#ffffff",
};
const check = (input: unknown) =>
  checkInput("designer pick-colours", screen, input, undefined, project);

describe("pick-colours input", () => {
  test("no input at all shows the colours in use", () => {
    const result = check({});
    if (!result.ok) throw new Error(result.text);
    expect(result.prepared?.current).toEqual({
      primary: "#e98428",
      background: "#ffffff",
    });
    expect(result.prepared?.proposed).toEqual({
      primary: undefined,
      background: undefined,
    });
  });

  test("a colour not in the accepted format is refused with the format and an example", () => {
    const result = check({ proposed: { primary: "brand blue" } });
    if (result.ok) throw new Error("brand blue was accepted");
    expect(result.refusal.wrong[0]?.field).toBe("proposed");
    expect(result.text).toContain('"brand blue"');
    expect(result.text).toContain('a # and six hex digits, such as "#1d4ed8"');
  });

  test("a proposal of the colours in use is refused, whatever its case", () => {
    const result = check({
      proposed: { primary: "#E98428", background: "#ffffff" },
    });
    if (result.ok) throw new Error("the colours in use were proposed");
    expect(result.refusal.wrong[0]?.problem).toBe(
      "#E98428, #ffffff are already the colours in use.",
    );
  });
});

test("guidance names the project values Builder supplies", () => {
  expect(
    guidanceText(
      "designer pick-colours",
      screen,
      manifest.builder.actions["pick-colours"].reads,
    ),
  ).toContain(
    "Builder gives the screen the project's look.color-primary, look.color-background itself; do not pass them.",
  );
});
