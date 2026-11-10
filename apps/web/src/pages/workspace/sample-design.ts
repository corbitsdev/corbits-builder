/** A small design bundle for the stories that draw a design: two screens, one with an empty state. */
import type { DesignFiles } from "./design-bundle.ts";

const INDEX = `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <nav>
      <a href="#/orders">Orders</a>
      <a href="#/new-order">New order</a>
    </nav>
    <main>
      <section data-screen="orders">
        <div data-state="populated">
          <h1>Saturday orders</h1>
          <ul>
            <li>Lemon cake, collect 2pm</li>
            <li>Sourdough x4, collect 9am</li>
          </ul>
        </div>
        <div data-state="empty">
          <h1>Saturday orders</h1>
          <p>No orders yet.</p>
        </div>
      </section>
      <section data-screen="new-order">
        <div data-state="populated">
          <h1>New order</h1>
          <button>Save order</button>
        </div>
      </section>
    </main>
    <script>
      const show = () => {
        const [, screen = "orders", state] = location.hash.split("/");
        for (const section of document.querySelectorAll("[data-screen]")) {
          section.hidden = section.dataset.screen !== screen;
          [...section.querySelectorAll(":scope > [data-state]")].forEach(
            (part, index) => {
              part.hidden = state ? part.dataset.state !== state : index > 0;
            },
          );
        }
      };
      addEventListener("hashchange", show);
      show();
    </script>
  </body>
</html>`;

const STYLES = `:root {
  --primary: #e98428;
  --background: #faf7f2;
  --radius: 0.5rem;
  --font-sans: system-ui, sans-serif;
}
body {
  margin: 0;
  padding: 24px;
  background: var(--background);
  font-family: var(--font-sans);
}
nav {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
}
button {
  padding: 8px 16px;
  border: 0;
  border-radius: var(--radius);
  background: var(--primary);
  color: #fff;
}`;

const PLAN = `# Bakery orders

## Look

Warm paper tones with one orange accent, so the list reads like the counter's order pad.

## Screens

- **Orders**: Saturday's orders, soonest collection first.
- **New order**: what the customer wants and when they collect it.`;

/** The mockup alone, as a designer's unfiled draft has it. */
export const sampleDraft: DesignFiles = {
  "designs/index.html": INDEX,
  "designs/styles.css": STYLES,
};

export const sampleDesign: DesignFiles = { ...sampleDraft, "DESIGN.md": PLAN };
