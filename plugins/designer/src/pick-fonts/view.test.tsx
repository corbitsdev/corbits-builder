import { describe, expect, test } from "bun:test";
import { validateInput } from "@corbits-builder/plugin";
import data from "./data.json";
import screen from "./definition.ts";
import { Fonts, type Font } from "./schema.ts";
import { choice, text, type Prepared } from "./view.tsx";

const project = {
  "look.font-primary": "Inter",
  "look.font-secondary": "Georgia",
};

const prepare = (input: unknown, values: Record<string, string> = project) => {
  const checked = validateInput(
    "designer pick-fonts",
    screen,
    input,
    Fonts.assert(data),
    values,
  );
  if (!checked.ok || checked.prepared === undefined)
    throw new Error("The font picker does not prepare.");
  return checked.prepared satisfies Prepared;
};

const font = (name: string): Font => {
  const found = prepare({}).fonts.find((each) => each.name === name);
  if (found === undefined) throw new Error(`${name} is not offered.`);
  return found;
};

describe("font picker's main action", () => {
  test("keeps the fonts in use until one differs, and sends them unchanged", () => {
    const kept = choice(prepare({}), {});
    expect(kept.label).toBe(text.keep);
    expect(kept.answer).toEqual({
      primary: font("Inter"),
      secondary: font("Georgia"),
    });
    expect(choice(prepare({}), { primary: font("Inter") }).label).toBe(
      text.keep,
    );
  });

  test("changes the fonts once one differs, and sends the new one", () => {
    const changed = choice(prepare({}), { primary: font("Fraunces") });
    expect(changed.label).toBe(text.change);
    expect(changed.answer).toEqual({
      primary: font("Fraunces"),
      secondary: font("Georgia"),
    });
  });

  test("a proposal is not chosen until the person presses it", () => {
    const proposal = prepare({ proposed: { primary: "Fraunces" } });
    expect(choice(proposal, {}).label).toBe(text.keep);
    expect(choice(proposal, { primary: font("Fraunces") }).label).toBe(
      text.change,
    );
  });

  test("a font in use the list lacks sends nothing until that side is picked", () => {
    const notInList = prepare(
      {},
      {
        "look.font-primary": "Red Hat Display",
        "look.font-secondary": "Inter",
      },
    );
    const open = choice(notInList, {});
    expect(open.label).toBe(text.keep);
    expect(open.answer).toBeUndefined();
    expect(open.hint).toBe(text.missing("primary"));
    expect(choice(notInList, { primary: font("Fraunces") }).answer).toEqual({
      primary: font("Fraunces"),
      secondary: font("Inter"),
    });
  });
});
