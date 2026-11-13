import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { validateInput } from "@corbits-builder/plugin";
import pickFonts from "./definition.ts";
import fonts from "./data.json";
import { Fonts, type Font } from "./schema.ts";
import { FontPicker, text } from "./view.tsx";

const inList = {
  "look.font-primary": "Inter",
  "look.font-secondary": "Georgia",
};

const prepare = (
  input: Record<string, unknown>,
  project: Record<string, string> = inList,
) => {
  const checked = validateInput(
    "designer pick-fonts",
    pickFonts,
    input,
    Fonts.assert(fonts),
    project,
  );
  if (!checked.ok || checked.prepared === undefined)
    throw new Error("The font picker's own fonts do not prepare.");
  return { input: checked.input, project, prepared: checked.prepared };
};
const browsing = prepare({});

const font = (name: string): Font => {
  const found = browsing.prepared.fonts.find((each) => each.name === name);
  if (found === undefined) throw new Error(`${name} is not offered.`);
  return found;
};

type Props = Parameters<typeof FontPicker>[0];

const picker = (
  draft: Props["draft"],
  options: { answer?: Props["answer"]; facts?: string[] } = {},
  checked: Pick<Props, "input" | "project" | "prepared"> = browsing,
) =>
  renderToStaticMarkup(
    <FontPicker
      input={checked.input}
      project={checked.project}
      prepared={checked.prepared}
      facts={options.facts ?? []}
      draft={draft}
      setDraft={() => undefined}
      submit={() => Promise.resolve()}
      submitting={false}
      answer={options.answer}
    />,
  );

const mainAction = (html: string) =>
  /<button[^>]*>(Keep my fonts|Change my fonts)</.exec(html)?.[1];
const mainDisabled = (html: string) =>
  /<button[^>]*disabled=""[^>]*>(Keep my fonts|Change my fonts)</.test(html);
const option = (html: string, name: string) =>
  new RegExp(`role="option"(?:(?!role="option").)*?>${name}<`).test(html);

describe("font picker", () => {
  test("keeps the fonts in use until one differs, then changes them and offers a reset", () => {
    const open = picker({});
    expect(mainAction(open)).toBe(text.keep);
    expect(mainDisabled(open)).toBe(false);
    expect(open).not.toContain(`>${text.reset}<`);
    const changed = picker({ primary: font("Fraunces") });
    expect(mainAction(changed)).toBe(text.change);
    expect(mainDisabled(changed)).toBe(false);
    expect(changed).toContain(text.was("Inter"));
    expect(changed).toContain(`>${text.reset}<`);
  });

  test("a font in use that is not in the list shows its stored name, and the main action waits for that side", () => {
    const notInList = prepare(
      {},
      {
        "look.font-primary": "Red Hat Display",
        "look.font-secondary": "Inter",
      },
    );
    const html = picker({}, {}, notInList);
    expect(html).toContain(text.inUseNamed("Red Hat Display"));
    expect(mainDisabled(html)).toBe(true);
    expect(html).toContain(text.missing("primary"));
    const picked = picker({ primary: font("Fraunces") }, {}, notInList);
    expect(mainDisabled(picked)).toBe(false);
  });

  test("a generic family in use is named as the system's default font, not by its keyword", () => {
    const generic = prepare(
      { proposed: { primary: "Arial" } },
      { "look.font-primary": "system-ui", "look.font-secondary": "Inter" },
    );
    const html = picker({}, {}, generic).replaceAll("&#x27;", "'");
    expect(html).toContain(text.inUseNamed(text.systemFont));
    expect(html).not.toContain("system-ui");
  });

  test("a proposal is one press beside the fonts in use, with the list still there", () => {
    const html = picker({}, {}, prepare({ proposed: { primary: "Fraunces" } }));
    expect(html).toContain(text.useProposed("Fraunces", text.sides.primary));
    expect(mainAction(html)).toBe(text.keep);
    expect(html).toContain('role="listbox"');
  });

  test("fonts that need a connection the project lacks are left out and counted once", () => {
    const html = picker({});
    expect(option(html, "Inter")).toBe(true);
    expect(option(html, "Acumin Pro")).toBe(false);
    expect(html).toContain(text.hidden(11));
    const connected = picker({}, { facts: ["adobe_fonts_connected"] });
    expect(option(connected, "Acumin Pro")).toBe(true);
    expect(connected).not.toContain(text.hidden(11));
  });

  test("once answered it settles to one line naming the fonts", () => {
    const html = picker(
      {},
      { answer: { primary: font("Fraunces"), secondary: font("Georgia") } },
    );
    expect(html).toContain(text.asked);
    expect(html).toContain("Primary Fraunces, secondary Georgia");
    expect(html).not.toContain('role="listbox"');
  });
});
