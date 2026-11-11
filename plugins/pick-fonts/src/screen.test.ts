import { describe, expect, test } from "bun:test";
import { checkInput, checkOutput, guidanceText } from "@corbits-builder/plugin";
import raw from "../data/fonts.json";
import { Fonts, lists } from "./schema.ts";
import screen from "./screen.ts";

const fonts = Fonts.assert(raw);
const font = (name: string) => fonts.find((each) => each.name === name);
// What the hub reads from a design whose fonts are Inter and Space Mono.
const project = {
  "look.font-primary": "Inter",
  "look.font-secondary": "Space Mono",
};
const check = (input: unknown) =>
  checkInput("pick-fonts", screen, input, fonts, project);

describe("pick-fonts input", () => {
  test("no input at all offers every font and the fonts in use", () => {
    const result = check({});
    if (!result.ok) throw new Error(result.text);
    expect(result.prepared?.fonts).toEqual(fonts);
    expect(result.prepared?.current).toEqual({
      primary: font("Inter"),
      secondary: font("Space Mono"),
    });
    expect(result.prepared?.proposed).toEqual({
      primary: undefined,
      secondary: undefined,
    });
  });

  test("a proposal that differs from the fonts in use resolves to fonts", () => {
    const result = check({ proposed: { primary: "fraunces" } });
    if (!result.ok) throw new Error(result.text);
    expect(result.prepared?.proposed.primary).toEqual(font("Fraunces"));
    expect(result.prepared?.current.primary).toEqual(font("Inter"));
  });

  test("a proposal of the fonts in use is refused", () => {
    const result = check({
      proposed: { primary: "Inter", secondary: "Space Mono" },
    });
    if (result.ok) throw new Error("the fonts in use were proposed");
    expect(result.refusal.field).toBe("proposed");
    expect(result.refusal.problem).toBe(
      '"Inter", "Space Mono" are already the fonts in use.',
    );
  });

  test("a named list offers only its fonts", () => {
    const result = check({ list: "mono" });
    if (!result.ok) throw new Error(result.text);
    const names = result.prepared?.fonts.map((font) => font.name);
    expect(names).toContain("JetBrains Mono");
    expect(names).not.toContain("Inter");
    expect(
      result.prepared?.fonts.every((font) => font.lists.includes("mono")),
    ).toBe(true);
  });

  test("an unknown list is refused with every list and how to fix it", () => {
    const result = check({
      proposed: { primary: "Fraunces" },
      list: "handwriting",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.text).toBe(
      [
        "pick-fonts was not shown. One field is wrong.",
        "",
        'list: "handwriting" is not a list.',
        "  Use one of:",
        "    all      Every font. Use when the person has no preference.",
        "    sans     Clean and modern. Good for apps and dashboards.",
        "    serif    Classic and bookish. Good for long reading and editorial pages.",
        "    display  Loud and characterful. Good for headings and logos, not body text.",
        "    mono     Every letter the same width. Good for code and figures.",
        "  Or pass up to 20 font names.",
        "",
        'Your other fields were fine: proposed {"primary":"Fraunces"}.',
        "Call again with the same input and list corrected, or leave list out to offer every font.",
      ].join("\n"),
    );
  });

  test("a proposed font that does not exist is refused with the closest real ones", () => {
    const result = check({ proposed: { secondary: "Robotto" } });
    if (result.ok) throw new Error("Robotto was accepted");
    expect(result.refusal.field).toBe("proposed");
    expect(Object.keys(result.refusal.choices ?? {})[0]).toBe("Roboto");
    expect(result.text).toContain("    Roboto");
  });
});

describe("pick-fonts guidance and output", () => {
  test("guidance names every list with its description", () => {
    const text = guidanceText("pick-fonts", screen, []);
    for (const [name, about] of Object.entries(lists))
      expect(text).toContain(`\n    ${name.padEnd(9)}${about}\n`);
  });

  test("a chosen font without its license is rejected", () => {
    const inter = fonts.find((font) => font.name === "Inter");
    const result = checkOutput("pick-fonts", screen, {
      primary: { name: "Inter", lists: ["sans"] },
      secondary: inter,
    });
    if (result.ok) throw new Error("the output was accepted");
    expect(result.refusal.field).toBe("primary");
    expect(result.refusal.problem).toContain("license");
  });
});
