import { describe, expect, test } from "bun:test";
import { validateInput } from "@corbits-builder/plugin";
import screen from "./definition.ts";
import { choice, text, type Prepared } from "./view.tsx";

const project = {
  "look.color-primary": "#e98428",
  "look.color-background": "#ffffff",
};

const prepare = (input: unknown, values: Record<string, string> = project) => {
  const checked = validateInput(
    "designer pick-colours",
    screen,
    input,
    undefined,
    values,
  );
  if (!checked.ok || checked.prepared === undefined)
    throw new Error("The colour picker does not prepare.");
  return checked.prepared satisfies Prepared;
};

describe("colour picker's main action", () => {
  test("keeps the colours in use until one differs, and sends them unchanged", () => {
    const kept = choice(prepare({}), {});
    expect(kept.label).toBe(text.keep);
    expect(kept.answer).toEqual({ primary: "#e98428", background: "#ffffff" });
  });

  test("the same colour in other letters is still keeping it", () => {
    expect(choice(prepare({}), { background: "#FFFFFF" }).label).toBe(
      text.keep,
    );
  });

  test("changes the colours once one differs, and sends the new one", () => {
    const changed = choice(prepare({}), { primary: "#2f6db5" });
    expect(changed.label).toBe(text.change);
    expect(changed.answer).toEqual({
      primary: "#2f6db5",
      background: "#ffffff",
    });
  });

  test("a proposal is not chosen until the person presses it", () => {
    const proposal = prepare({ proposed: { primary: "#1d4ed8" } });
    expect(choice(proposal, {}).label).toBe(text.keep);
    expect(choice(proposal, { primary: "#1d4ed8" }).answer).toEqual({
      primary: "#1d4ed8",
      background: "#ffffff",
    });
  });

  test("sends nothing while a value is not a colour in the accepted format", () => {
    const typed = choice(prepare({}), { primary: "#2f6d" });
    expect(typed.label).toBe(text.change);
    expect(typed.answer).toBeUndefined();
    expect(typed.hint).toBe(text.format);
  });

  test("sends nothing while a side has no colour in use or chosen", () => {
    const missing = choice(
      prepare({}, { "look.color-primary": "#e98428" }),
      {},
    );
    expect(missing.answer).toBeUndefined();
    expect(missing.hint).toBe(text.missing);
  });
});
