import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsRow } from "./settings-row.tsx";

test("a row names its control in its key, with one hint line per entry", () => {
  const html = renderToStaticMarkup(
    <SettingsRow
      label="Theme"
      hint={["Light or dark", null, "On this device"]}
      htmlFor="theme"
    >
      <select id="theme" />
    </SettingsRow>,
  );

  expect(html).toMatch(
    /data-slot="settings-row-key"><label for="theme"><span [^>]*>Theme<\/span><\/label>/,
  );
  expect(html.match(/>Light or dark<|>On this device</g)).toHaveLength(2);
  expect(html).not.toContain("data-highlighted");
});

test("a highlighted row carries the flag, and a bare row has no key", () => {
  const html = renderToStaticMarkup(
    <SettingsRow highlighted>
      <button type="button">Sign out</button>
    </SettingsRow>,
  );

  expect(html).toContain('data-slot="settings-row" data-highlighted=""');
  expect(html).not.toContain('data-slot="settings-row-key"');
});
