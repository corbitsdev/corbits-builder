import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { validateInput } from "@corbits-builder/plugin";
import pickFonts from "@corbits-builder/designer/pick-fonts";
import fonts from "@corbits-builder/designer/pick-fonts/data";
import { Fonts, type Font } from "@corbits-builder/designer/pick-fonts/schema";
import { FontPicker, text } from "@corbits-builder/designer/pick-fonts/view";

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

const saveDisabled = (html: string) =>
  /<button[^>]*disabled=""[^>]*>Save fonts</.test(html);
const option = (html: string, name: string) =>
  new RegExp(`role="option"(?:(?!role="option").)*?>${name}<`).test(html);

describe("font picker", () => {
  test("starts from the fonts in use, and Save waits for a change", () => {
    const open = picker({});
    expect(saveDisabled(open)).toBe(true);
    expect(open).toContain(text.unchanged);
    const changed = picker({ primary: font("Fraunces") });
    expect(saveDisabled(changed)).toBe(false);
    expect(changed).not.toContain(text.unchanged);
  });

  test("a font in use that is not in the list shows its stored name, and Save waits for that side", () => {
    const notInList = prepare(
      {},
      {
        "look.font-primary": "Red Hat Display",
        "look.font-secondary": "Inter",
      },
    );
    const html = picker({}, {}, notInList);
    expect(html).toContain(text.inUseNamed("Red Hat Display"));
    expect(saveDisabled(html)).toBe(true);
    expect(html).toContain(text.missing("primary"));
    const picked = picker({ primary: font("Fraunces") }, {}, notInList);
    expect(saveDisabled(picked)).toBe(false);
  });

  test("a proposal shows the font in use beside the proposed one, not the list", () => {
    const html = picker({}, {}, prepare({ proposed: { primary: "Fraunces" } }));
    expect(html).toContain(text.inUseNamed("Inter"));
    expect(html).toContain(text.proposedNamed("Fraunces"));
    expect(html).toContain(text.useProposed);
    expect(html).not.toContain('role="listbox"');
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
    expect(html).toContain("Primary: Fraunces. Secondary: Georgia.");
    expect(html).not.toContain('role="listbox"');
  });
});
