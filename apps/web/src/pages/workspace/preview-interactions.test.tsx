import { describe, expect, test } from "bun:test";
import "./plugin-roles.testing.ts";
import { renderToStaticMarkup } from "react-dom/server";
import { firstPage } from "./design-bundle.ts";
import { designDraftFiled } from "./design-preview.model.ts";
import { predecessorOf } from "./document-versions.ts";
import { DevicePreview } from "./device-preview.tsx";
import { GuiFrame } from "./gui-frame.tsx";

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

  const tag = (html: string, slot: string) =>
    new RegExp(`<[a-z]+[^>]*data-slot="${slot}"[^>]*>`).exec(html)?.[0] ?? "";

  test("a preview that fills its pane says so on itself and its frame", () => {
    const html = renderToStaticMarkup(
      <DevicePreview
        html="<h1>Actual design</h1>"
        device="desktop"
        onDevice={() => {}}
        fill
      />,
    );
    expect(tag(html, "device-preview")).toContain('data-fill=""');
    expect(tag(html, "gui-frame")).toContain('data-fill=""');
    expect(tag(html, "gui-frame")).not.toContain("data-thumbnail");
  });

  test("a preview in a document keeps its page-high frame", () => {
    const html = renderToStaticMarkup(
      <DevicePreview
        html="<h1>Actual design</h1>"
        device="desktop"
        onDevice={() => {}}
      />,
    );
    expect(html).not.toContain("data-fill");
  });

  test("a thumbnail frame is marked for its scaled-down size", () => {
    const html = renderToStaticMarkup(
      <GuiFrame html="<h1>Theme</h1>" thumbnail />,
    );
    expect(tag(html, "gui-frame")).toContain('data-thumbnail=""');
    expect(tag(html, "gui-frame")).not.toContain("data-fill");
  });

  test("splices per-screen files into index.html in navigation order", () => {
    const rendered = firstPage({
      "designs/index.html":
        '<nav><a href="#/overview">Overview</a><a href="#/orders">Orders</a></nav><main class="app-main"></main>',
      "designs/screens/home.html": [
        '<section data-screen="home" data-testid="screen-home">',
        '  <div data-state="populated" data-testid="home-populated">',
        '    <h1 data-testid="home-title">Hello, world</h1>',
        "  </div>",
        "</section>",
      ].join("\n"),
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

  test("keeps a home screen that retains the starter heading and adds copy", () => {
    const rendered = firstPage({
      "designs/index.html":
        '<nav><a href="#/home">Home</a><a href="#/orders">Orders</a></nav><main class="app-main"></main>',
      "designs/screens/home.html": [
        '<section data-screen="home" data-testid="screen-home">',
        '  <div data-state="populated" data-testid="home-populated">',
        '    <h1 data-testid="home-title">Hello, world</h1>',
        "    <p>Welcome back to the studio.</p>",
        "  </div>",
        "</section>",
      ].join("\n"),
      "designs/screens/orders.html":
        '<section data-screen="orders"><h1>Orders</h1></section>',
    });
    expect(rendered).toContain('data-screen="home"');
    expect(rendered).toContain("Welcome back to the studio.");
    expect(rendered).toContain('data-screen="orders"');
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

describe("design draft", () => {
  test("keeps reading when the room snapshot has not loaded", () => {
    expect(designDraftFiled(false, undefined)).toBe(false);
  });

  test("stops once a design is filed or no whole-mockup designer is running", () => {
    expect(designDraftFiled(true, undefined)).toBe(true);
    expect(designDraftFiled(false, [])).toBe(true);
    expect(
      designDraftFiled(false, [{ role: "designer", concept: "Quiet" }]),
    ).toBe(true);
    expect(designDraftFiled(false, [{ role: "coder" }])).toBe(true);
  });

  test("keeps reading while a designer drafts the whole mockup", () => {
    expect(designDraftFiled(false, [{ role: "designer" }])).toBe(false);
    expect(designDraftFiled(true, [{ role: "designer" }])).toBe(true);
  });
});
