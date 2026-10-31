import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { predecessorOf } from "./document-versions.ts";
import { DevicePreview } from "./device-preview.tsx";

describe("document versions", () => {
  test("uses the index when it is present and does not invent a predecessor", () => {
    expect(predecessorOf([{ version: 2 }, { version: 4 }], 4, 4, 2)).toBe(2);
    expect(predecessorOf([{ version: 2 }], 2, 2, null)).toBeNull();
    expect(predecessorOf(undefined, 3, 3, 2)).toBe(2);
    expect(predecessorOf([], 3, 3, null)).toBeNull();
  });
});

describe("device preview", () => {
  test("frames saved HTML without enabling scripts", () => {
    const html = renderToStaticMarkup(
      <DevicePreview
        html="<h1>Actual design</h1>"
        device="phone"
        onDevice={() => {}}
      />,
    );
    expect(html).toContain('sandbox=""');
    expect(html).not.toContain("allow-scripts");
  });
});
