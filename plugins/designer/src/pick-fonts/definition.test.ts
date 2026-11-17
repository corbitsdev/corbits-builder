import { describe, expect, test } from "bun:test";
import { validateInput } from "@corbits-builder/plugin";
import raw from "./data.json";
import { Fonts } from "./schema.ts";
import screen from "./definition.ts";

const fonts = Fonts.assert(raw);
// What the hub reads from a design whose fonts are Inter and Space Mono.
const project = {
  "look.font-primary": "Inter",
  "look.font-secondary": "Space Mono",
};
const check = (input: unknown) =>
  validateInput("designer pick-fonts", screen, input, fonts, project);

describe("pick-fonts input", () => {
  test("an unknown list is refused with every list and how to fix it", () => {
    const result = check({
      proposed: { primary: "Fraunces" },
      list: "handwriting",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.text).toBe(
      [
        "designer pick-fonts was not shown. One field is wrong.",
        "",
        'list: "handwriting" is not a list.',
        "  Use one of:",
        "    all      Every font. Use when the person has no preference.",
        "    sans     Clean and modern. Good for apps and dashboards.",
        "    serif    Classic and bookish. Good for long reading and editorial pages.",
        "    display  Loud and characterful. Good for headings and logos, not body text.",
        "    mono     Every letter the same width. Good for code and figures.",
        "  Or pass up to 20 font names. Or leave list out to offer every font.",
        "",
        'Your other fields were fine: proposed {"primary":"Fraunces"}.',
        "Call again with the same input and list corrected.",
      ].join("\n"),
    );
  });

  test("a proposed font that does not exist is refused with the closest real ones", () => {
    const result = check({ proposed: { secondary: "Robotto" } });
    if (result.ok) throw new Error("Robotto was accepted");
    expect(result.refusal.wrong[0]?.field).toBe("proposed");
    expect(Object.keys(result.refusal.wrong[0]?.choices ?? {})[0]).toBe(
      "Roboto",
    );
    expect(result.text).toContain("    Roboto");
  });
});
