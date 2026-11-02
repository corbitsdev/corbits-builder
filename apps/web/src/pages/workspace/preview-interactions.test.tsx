import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { firstPage } from "./design-preview.tsx";
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

  test("splices per-screen files into index.html in navigation order", () => {
    const rendered = firstPage({
      "designs/index.html":
        '<nav><a href="#/overview">Overview</a><a href="#/orders">Orders</a></nav><main class="app-main"></main>',
      "designs/screens/home.html":
        '<section data-screen="home"><h1 data-testid="home-title">Hello, world</h1></section>',
      "designs/screens/orders.html":
        '<section data-screen="orders"><h1>Orders</h1></section>',
      "designs/screens/overview.html":
        '<section data-screen="overview"><h1>Overview</h1></section>',
    });
    expect(rendered).not.toContain("Hello, world");
    expect(rendered.indexOf('data-screen="overview"')).toBeLessThan(
      rendered.indexOf('data-screen="orders"'),
    );
    expect(rendered.indexOf('data-screen="orders"')).toBeLessThan(
      rendered.indexOf("</main>"),
    );
  });

  test("wraps a screen file that omits data-screen or includes a body tag", () => {
    const rendered = firstPage({
      "designs/index.html":
        '<nav><a href="#/orders">Orders</a></nav><main class="app-main"></main>',
      "designs/screens/orders.html":
        "<!doctype html><html><body><div><h1>Orders</h1></div><script>alert(1)</script></body></html>",
    });
    expect(rendered).toContain('<section data-screen="orders">');
    expect(rendered).toContain("<div><h1>Orders</h1></div>");
    expect(rendered).not.toContain("alert(1)");
  });
});
