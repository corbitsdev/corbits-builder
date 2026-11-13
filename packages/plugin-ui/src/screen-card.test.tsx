import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ScreenSettled } from "./screen-card.tsx";

describe("settled screen", () => {
  test("keeps what was asked before what was answered, on one line with a tick", () => {
    const html = renderToStaticMarkup(
      <ScreenSettled
        asked="Approve the build plan?"
        answer="Approved, version 1"
      />,
    ).replace(/ class="[^"]*"/g, "");
    expect(html).toMatch(
      /^<p data-slot="screen-settled"><svg[^>]*aria-hidden="true"[^]*<\/svg><span><span>Approve the build plan\?<\/span> <span>Approved, version 1<\/span><\/span><\/p>$/,
    );
  });
});
