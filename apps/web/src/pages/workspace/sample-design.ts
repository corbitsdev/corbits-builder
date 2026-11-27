/** A small design bundle for the stories that draw a design: two screens, one with an empty state. */
import type { DesignFiles } from "./design-bundle.ts";

const INDEX = `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <header>
      <strong class="shop">Crumb &amp; Co.</strong>
      <nav>
        <a href="#/orders" data-testid="nav-orders">Orders</a>
        <a href="#/new-order" data-testid="nav-new-order">New order</a>
      </nav>
    </header>
    <main>
      <section data-screen="orders">
        <div data-state="populated">
          <div class="title">
            <h1>Saturday orders</h1>
            <a class="button" href="#/new-order">New order</a>
          </div>
          <p class="summary">4 orders · 3 to collect before noon</p>
          <ul class="orders" data-testid="orders-list">
            <li>
              <span class="time">9:00</span>
              <span class="what"><b>Sourdough loaf ×4</b><small>Priya Shah</small></span>
              <span class="state ready">Ready</span>
            </li>
            <li>
              <span class="time">10:30</span>
              <span class="what"><b>Cinnamon buns ×12</b><small>Tom Avery</small></span>
              <span class="state baking">Baking</span>
            </li>
            <li>
              <span class="time">11:45</span>
              <span class="what"><b>Rye loaf ×2</b><small>Lena Ortiz</small></span>
              <span class="state">To bake</span>
            </li>
            <li>
              <span class="time">14:00</span>
              <span class="what"><b>Lemon cake, 8 inch</b><small>Sam Okafor · “Happy 40th Jo”</small></span>
              <span class="state">To bake</span>
            </li>
          </ul>
        </div>
        <div data-state="empty">
          <div class="title"><h1>Saturday orders</h1></div>
          <p class="empty">No orders for Saturday yet. New ones show here as customers place them.</p>
        </div>
      </section>
      <section data-screen="new-order">
        <div data-state="populated">
          <div class="title"><h1>New order</h1></div>
          <form class="card">
            <label>Customer<input value="Sam Okafor" /></label>
            <label>What they want<input value="Lemon cake, 8 inch" /></label>
            <label>Collect at<input value="Saturday, 14:00" /></label>
            <button type="button">Save order</button>
          </form>
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
  background: var(--background);
  color: #2b2118;
  font-family: var(--font-sans);
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 32px;
  border-bottom: 1px solid #eadfd1;
  background: #fff;
}
.shop {
  font-size: 18px;
}
nav {
  display: flex;
  gap: 24px;
}
nav a {
  color: #6b5a49;
  text-decoration: none;
}
main {
  max-width: 720px;
  margin: 0 auto;
  padding: 32px;
}
.title {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
h1 {
  margin: 0;
  font-size: 28px;
}
.summary,
.empty {
  color: #6b5a49;
}
.orders {
  display: grid;
  gap: 8px;
  margin: 24px 0 0;
  padding: 0;
  list-style: none;
}
.orders li,
.card {
  border: 1px solid #eadfd1;
  border-radius: var(--radius);
  background: #fff;
}
.orders li {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 16px;
}
.time {
  width: 48px;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.what {
  display: grid;
  flex: 1;
  gap: 2px;
}
.what small {
  color: #8a7766;
}
.state {
  padding: 2px 10px;
  border-radius: 999px;
  background: #f1ebe3;
  color: #6b5a49;
  font-size: 13px;
}
.state.ready {
  background: #e3f1e5;
  color: #2e6b3a;
}
.state.baking {
  background: #fcebd9;
  color: #9a4f12;
}
.card {
  display: grid;
  gap: 16px;
  margin-top: 24px;
  padding: 24px;
}
label {
  display: grid;
  gap: 6px;
  color: #6b5a49;
  font-size: 14px;
}
input {
  padding: 10px 12px;
  border: 1px solid #eadfd1;
  border-radius: var(--radius);
  font: inherit;
  color: #2b2118;
}
button,
.button {
  justify-self: start;
  padding: 10px 18px;
  border: 0;
  border-radius: var(--radius);
  background: var(--primary);
  color: #fff;
  font: inherit;
  text-decoration: none;
  white-space: nowrap;
}
@media (max-width: 480px) {
  header,
  main {
    padding: 16px;
  }
  h1 {
    font-size: 22px;
  }
  .time {
    width: 40px;
  }
}`;

const PLAN = `---
name: "Bakery orders"
colors:
  background: "#fbf8f3"
  primary: "#d9622b"
---

# Bakery orders

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
