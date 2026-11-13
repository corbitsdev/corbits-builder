import { expect } from "bun:test";
import type { Page } from "@playwright/test";
import { writerFiles } from "./specialists.ts";
import { execute, ok, results, say, scenario, turn, user } from "./runner.ts";

const WAIT_MS = 180_000;
const first = "The competitor analysis is filed.";
const revised = "The competitor analysis now has prices.";
const done = "The revision with prices is in.";

const words = (text: string) => text.replace(/\s+/g, " ").trim();

// What the page shows of the work: each settled card's line, and each row of work with its words,
// where it stands, how many steps it shows and what it offers beside it.
async function shown(page: Page) {
  const settled = (
    await page.locator('[data-slot="screen-settled"]').allInnerTexts()
  ).map(words);
  const rows = page.locator(
    'xpath=//*[@data-slot="tool"][not(ancestor::*[@data-slot="tool"])]',
  );
  const read = [];
  for (const row of await rows.all()) {
    const actions = [];
    for (const action of await row
      .locator('xpath=./div[1]//button[not(@data-slot="tool-header")]')
      .all())
      actions.push(
        (await action.getAttribute("aria-label")) ??
          words(await action.innerText()),
      );
    read.push({
      row: words(
        await row.locator('[data-slot="tool-header"]').first().innerText(),
      ),
      state: await row.getAttribute("data-status"),
      steps: await row.locator('[data-slot="tool"]').count(),
      actions,
    });
  }
  return { settled, rows: read };
}

// The page as it settles: read until two reads a few seconds apart agree.
async function settledView(page: Page) {
  let last = await shown(page);
  for (;;) {
    await page.waitForTimeout(3_000);
    const next = await shown(page);
    if (JSON.stringify(next) === JSON.stringify(last)) return next;
    last = next;
  }
}

scenario({
  name: "s43-page-survives-a-reload-browser",
  title:
    "after a reload the page shows the same answered approval card and the same rows of work, with their states, steps and actions",
  start: { fresh: "Write me a competitor analysis of the dog-walking apps." },
  coordinator: [
    turn(
      user("competitor analysis"),
      execute("c_write", "writer", "write", {
        kind: "competitor_analysis",
        title: "Competitor analysis",
        instruction: "Compare the dog-walking apps people near us use.",
      }),
    ),
    turn(results(ok("c_write", "execute")), say("A writer is on it.")),
    turn(
      user(first),
      execute("c_approve", "writer", "approve", {
        kinds: ["competitor_analysis"],
      }),
    ),
    turn(
      results(ok("c_approve", "execute")),
      execute("c_revise", "writer", "write", {
        kind: "competitor_analysis",
        title: "Competitor analysis",
        instruction: "Add the price of a walk to every app compared.",
      }),
    ),
    turn(results(ok("c_revise", "execute")), say("A writer is adding prices.")),
    turn(user(revised), say(done)),
  ],
  specialists: {
    "writer-1": {
      role: "writer",
      turns: writerFiles({
        assignedWith: "Compare the dog-walking apps",
        kind: "competitor_analysis",
        content: "## In short\nThree apps serve our area.",
        report: first,
      }),
    },
    "writer-2": {
      role: "writer",
      turns: writerFiles({
        assignedWith: "Add the price of a walk",
        kind: "competitor_analysis",
        content:
          "## In short\nThree apps serve our area, from 15 to 25 a walk.",
        report: revised,
      }),
    },
  },
  person: async (p) => {
    await p.browser(async (page, shoot) => {
      const card = page.locator('[data-slot="approve-documents"]');
      await card.waitFor({ timeout: WAIT_MS });
      await page.getByRole("button", { name: "Approve", exact: true }).click();
      await page.getByText(done).first().waitFor({ timeout: WAIT_MS });
      await page
        .locator('[data-slot="tool"][data-status="running"]')
        .first()
        .waitFor({ state: "detached", timeout: WAIT_MS });
      const before = await settledView(page);
      p.note("the page before the reload", before);
      await shoot("01-before-reload");
      // The view is worth comparing only if it holds an answered card and a row with its steps.
      expect(before.settled.length).toBeGreaterThan(0);
      expect(before.rows.some(({ steps }) => steps > 0)).toBe(true);

      await page.reload();
      await page.getByText(done).first().waitFor({ timeout: WAIT_MS });
      const after = await settledView(page);
      p.note("the page after the reload", after);
      await shoot("02-after-reload");
      expect(after).toEqual(before);
    });
    expect((await p.filed("competitor_analysis", 2)).approvedVersion).toBe(1);
  },
});
