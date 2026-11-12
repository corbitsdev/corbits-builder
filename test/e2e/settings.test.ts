import { afterAll, beforeAll, expect, test } from "bun:test";
import { type } from "arktype";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import {
  chromium,
  expect as browserExpect,
  type Browser,
  type Page,
} from "@playwright/test";
import { PreferenceRegistry } from "@corbits-builder/schemas/preferences";
import { SettingsRecord } from "@corbits-builder/schemas/settings";
import { startInProcessHub } from "./support/in-process-hub.ts";

let hub: Awaited<ReturnType<typeof startInProcessHub>>;
let browser: Browser;
let server: ReturnType<typeof Bun.serve>;
let path: string;
let registry: PreferenceRegistry;
let dist: string;

beforeAll(async () => {
  dist = await mkdtemp(join(tmpdir(), "builder-settings-ui-"));
  const build = Bun.spawn(
    ["bun", "run", "--cwd", "apps/web", "build", "--outDir", dist],
    {
      cwd: resolve(import.meta.dir, "../.."),
      env: { ...process.env, NODE_ENV: "production" },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [status, output, errors] = await Promise.all([
    build.exited,
    new Response(build.stdout).text(),
    new Response(build.stderr).text(),
  ]);
  if (status !== 0) throw new Error(`Web build failed: ${output}\n${errors}`);
  hub = await startInProcessHub();
  const workspace = type({ id: "string > 0" }).assert(
    await (
      await hub.call("POST", "/api/workspaces", { name: "Settings test" })
    ).json(),
  );
  path = `/api/tenants/${workspace.id}/settings`;
  registry = PreferenceRegistry.assert(
    await (await hub.call("GET", `${path}/preferences`)).json(),
  );
  // Forward the test person's session to the real hub, without running agents or sidecars.
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/")) {
        if (request.method !== "GET" && request.method !== "POST")
          return new Response(null, { status: 405 });
        return hub.call(
          request.method,
          url.pathname + url.search,
          request.method === "POST"
            ? type("object").assert(await request.json())
            : undefined,
        );
      }
      const filename = resolve(dist, `.${url.pathname}`);
      if (filename !== dist && !filename.startsWith(dist + sep))
        return new Response(null, { status: 404 });
      const file = Bun.file(filename);
      return new Response(
        url.pathname !== "/" && (await file.exists())
          ? file
          : Bun.file(resolve(dist, "index.html")),
      );
    },
  });
  const executablePath = process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"];
  browser = await chromium.launch(executablePath ? { executablePath } : {});
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await server?.stop(true);
  await hub?.close();
  if (dist) await rm(dist, { recursive: true, force: true });
});

async function openSettings(page: Page) {
  await page.addInitScript(() =>
    sessionStorage.setItem("sb.model-setup.later", "1"),
  );
  await page.goto(`${server.url}?view=settings&tab=preferences`);
  await browserExpect(
    page.locator("#preference-row-replies button").first(),
  ).toBeEnabled();
}

async function readPreferences() {
  return SettingsRecord.assert(
    await (await hub.call("GET", `${path}/me`)).json(),
  ).fields.preferences!;
}

async function choose(page: Page, id: string, choice: string) {
  const preference = registry.preferences.find((entry) => entry.id === id)!;
  const row = page.locator(`#preference-row-${id}`);
  if (preference.ends) {
    const index = preference.options.findIndex(
      (option) => option.id === choice,
    );
    await row.getByRole("slider").focus();
    await page.keyboard.press("Home");
    for (let stop = 0; stop < index; stop++)
      await page.keyboard.press("ArrowRight");
  } else {
    await row
      .getByRole("radio", {
        name: preference.options.find((option) => option.id === choice)!.label,
        exact: true,
      })
      .click();
  }
  await browserExpect(row.getByText("Saved", { exact: true })).toBeVisible();
  await browserExpect
    .poll(async () => (await readPreferences()).value?.[id])
    .toBe(choice);
}

test("selected settings choices keep their option names for assistive technology", async () => {
  const page = await browser.newPage();
  try {
    await openSettings(page);
    for (const group of await page.getByRole("radiogroup").all()) {
      const selected = group.getByRole("radio", { checked: true });
      await browserExpect(selected).toHaveAccessibleName(
        (await selected.innerText()).trim(),
      );
    }
  } finally {
    await page.close();
  }
}, 30_000);

test("settings fit phone, narrow desktop and full desktop widths", async () => {
  const page = await browser.newPage();
  try {
    await openSettings(page);
    for (const width of [320, 390, 560, 561, 600, 640, 700, 768, 1100]) {
      await page.setViewportSize({ width, height: 1000 });
      const content = await page
        .locator("html")
        .evaluate((element: { scrollWidth: number }) => element.scrollWidth);
      const rows = await page.locator('[data-slot="settings-row"]').evaluateAll(
        (
          elements: {
            scrollWidth: number;
            clientWidth: number;
            textContent: string | null;
          }[],
        ) =>
          elements
            .filter((row) => row.scrollWidth > row.clientWidth + 1)
            .map((row) => ({
              text: row.textContent,
              width: row.clientWidth,
              content: row.scrollWidth,
            })),
      );
      expect(content, `page at ${width}px`).toBeLessThanOrEqual(width);
      expect(rows, `rows at ${width}px`).toEqual([]);
    }
  } finally {
    await page.close();
  }
}, 30_000);

test("a conflict adopts newer settings even for choices already saved in this tab", async () => {
  const page = await browser.newPage();
  try {
    await openSettings(page);
    await choose(page, "replies", "detailed");
    const before = await readPreferences();
    await hub.call("POST", `${path}/me/save`, {
      command: "save_settings",
      idempotencyKey: crypto.randomUUID(),
      fields: {
        preferences: {
          value: { ...before.value, replies: "concise" },
          baseVersion: before.version,
        },
      },
    });
    await page
      .locator("#preference-row-technical")
      .getByRole("radio", { name: "Technical", exact: true })
      .click();
    await browserExpect(
      page
        .locator("#preference-row-technical")
        .getByText("Not saved", { exact: true }),
    ).toBeVisible();
    await browserExpect(
      page
        .locator("#preference-row-replies")
        .getByRole("radio", { checked: true }),
    ).toHaveText("Concise");
    await choose(page, "technical", "yes");
    expect((await readPreferences()).value?.["replies"]).toBe("concise");
  } finally {
    await page.close();
  }
}, 30_000);

test("every registered preference option saves through the hub and survives reopening Settings", async () => {
  const page = await browser.newPage();
  try {
    await openSettings(page);
    for (const preference of registry.preferences) {
      for (const option of preference.options) {
        await choose(page, preference.id, option.id);
        await page.reload();
        const row = page.locator(`#preference-row-${preference.id}`);
        if (preference.ends) {
          await browserExpect(row.getByRole("slider")).toHaveAttribute(
            "aria-valuetext",
            option.label,
          );
        } else {
          await browserExpect(
            row.getByRole("radio", { name: option.label, exact: true }),
          ).toBeChecked();
        }
      }
    }
  } finally {
    await page.close();
  }
}, 120_000);

test("rapid changes save one at a time and keep the most recent choices", async () => {
  const page = await browser.newPage();
  try {
    await openSettings(page);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const versions: number[] = [];
    await page.route("**/settings/me/save", async (route) => {
      versions.push(
        route.request().postDataJSON().fields.preferences.baseVersion,
      );
      if (versions.length === 1) await gate;
      await route.continue();
    });
    const replies = page.locator("#preference-row-replies");
    await replies.getByRole("radio", { name: "Concise", exact: true }).click();
    await browserExpect(
      replies.getByText("Saving…", { exact: true }),
    ).toBeVisible();
    await replies.getByRole("radio", { name: "Detailed", exact: true }).click();
    await page
      .locator("#preference-row-technical")
      .getByRole("radio", { name: "Plain", exact: true })
      .click();
    expect(versions).toHaveLength(1);
    release();
    await browserExpect
      .poll(async () => (await readPreferences()).value)
      .toMatchObject({ replies: "detailed", technical: "no" });
    await browserExpect(
      page
        .locator("#preference-row-technical")
        .getByText("Saved", { exact: true }),
    ).toBeVisible();
    expect(versions).toHaveLength(3);
    expect(versions[1]).toBe(versions[0]! + 1);
    expect(versions[2]).toBe(versions[1]! + 1);
    await page.reload();
    await browserExpect(
      replies.getByRole("radio", { name: "Detailed", exact: true }),
    ).toBeChecked();
  } finally {
    await page.close();
  }
}, 30_000);

test("a failed save restores each preference and a later retry can save", async () => {
  const page = await browser.newPage();
  try {
    await openSettings(page);
    for (const preference of registry.preferences) {
      const before = await readPreferences();
      const oldChoice = before.value?.[preference.id] ?? preference.default;
      const option = preference.options.find(
        (option) => option.id !== oldChoice,
      )!;
      await page.route("**/settings/me/save", (route) =>
        route.fulfill({ status: 503, body: "Unavailable" }),
      );
      const row = page.locator(`#preference-row-${preference.id}`);
      if (preference.ends) {
        await row.getByRole("slider").focus();
        await page.keyboard.press(
          option.id === preference.options[0]!.id ? "Home" : "End",
        );
      } else {
        await row
          .getByRole("radio", { name: option.label, exact: true })
          .click();
      }
      await browserExpect(
        row.getByText("Not saved", { exact: true }),
      ).toBeVisible();
      if (preference.ends) {
        await browserExpect(row.getByRole("slider")).toHaveAttribute(
          "aria-valuetext",
          preference.options.find((option) => option.id === oldChoice)!.label,
        );
      } else {
        await browserExpect(
          row.getByRole("radio", {
            name: preference.options.find((option) => option.id === oldChoice)!
              .label,
            exact: true,
          }),
        ).toBeChecked();
      }
      expect(await readPreferences()).toEqual(before);
      await page.unroute("**/settings/me/save");
      await choose(page, preference.id, option.id);
    }
  } finally {
    await page.close();
  }
}, 90_000);

test("browser choices persist without sending personal-settings saves", async () => {
  const page = await browser.newPage();
  try {
    await openSettings(page);
    const saves: string[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/settings/me/save"))
        saves.push(request.url());
    });
    for (const name of ["Hidden", "Shown"]) {
      await page
        .getByRole("radiogroup", { name: "Document tips", exact: true })
        .getByRole("radio", { name, exact: true })
        .click();
      await page.reload();
      await browserExpect(
        page
          .getByRole("radiogroup", { name: "Document tips", exact: true })
          .getByRole("radio", { name, exact: true }),
      ).toBeChecked();
    }
    for (const name of ["Dark", "Light", "System"]) {
      await page
        .getByRole("radiogroup", { name: "Theme", exact: true })
        .getByRole("radio", { name, exact: true })
        .click();
      await page.reload();
      await browserExpect(
        page
          .getByRole("radiogroup", { name: "Theme", exact: true })
          .getByRole("radio", { name, exact: true }),
      ).toBeChecked();
      if (name === "System") {
        await page.emulateMedia({ colorScheme: "dark" });
        await browserExpect(page.locator("html")).toHaveClass(/dark/);
        await page.emulateMedia({ colorScheme: "light" });
        await browserExpect(page.locator("html")).not.toHaveClass(/dark/);
      }
    }
    expect(saves).toEqual([]);
  } finally {
    await page.close();
  }
}, 60_000);

test("reviewers can be added with built-in and custom roles, reopened and removed", async () => {
  const page = await browser.newPage();
  try {
    await openSettings(page);
    for (const custom of [false, true]) {
      const name = custom ? "Custom reviewer" : "Built-in reviewer";
      await page
        .getByRole("button", { name: "Add reviewer", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await browserExpect(
        dialog.getByRole("button", { name: "Add reviewer", exact: true }),
      ).toBeDisabled();
      await dialog
        .getByRole("textbox", { name: "Reviewer name", exact: true })
        .fill(name);
      if (custom) {
        await dialog.getByRole("combobox").selectOption("__other__");
        await dialog
          .getByRole("textbox", { name: /persona|role/i })
          .fill("Finance lead");
      }
      await dialog
        .getByRole("textbox", {
          name: "Goal or decision focus (optional)",
          exact: true,
        })
        .fill("Budget fit");
      await dialog
        .getByRole("textbox", { name: "Email (optional)", exact: true })
        .fill("reviewer@example.invalid");
      await dialog
        .getByRole("button", { name: "Add reviewer", exact: true })
        .click();
      await browserExpect(dialog).not.toBeVisible();
      await page.reload();
      const row = page
        .locator('[data-slot="settings-row"]')
        .filter({ has: page.getByText(name, { exact: true }) });
      await browserExpect(row).toContainText("Budget fit");
      await browserExpect(row).toContainText("reviewer@example.invalid");
      if (custom) await browserExpect(row).toContainText("Finance lead");
      await row.getByRole("button", { name: "Remove", exact: true }).click();
      await page.reload();
      await browserExpect(page.getByText(name, { exact: true })).toHaveCount(0);
    }
  } finally {
    await page.close();
  }
}, 60_000);

test("an older failed save cannot discard a newer click of the same option", async () => {
  const page = await browser.newPage();
  try {
    await openSettings(page);
    await choose(page, "replies", "detailed");
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requests = 0;
    await page.route("**/settings/me/save", async (route) => {
      requests++;
      if (requests === 1) {
        await gate;
        await route.fulfill({ status: 503, body: "Unavailable" });
      } else {
        await route.continue();
      }
    });
    const row = page.locator("#preference-row-replies");
    await row.getByRole("radio", { name: "Concise", exact: true }).click();
    await browserExpect(
      row.getByText("Saving…", { exact: true }),
    ).toBeVisible();
    await row.getByRole("radio", { name: "Detailed", exact: true }).click();
    await row.getByRole("radio", { name: "Concise", exact: true }).click();
    release();
    await browserExpect
      .poll(async () => (await readPreferences()).value?.["replies"])
      .toBe("concise");
    await browserExpect(row.getByText("Saved", { exact: true })).toBeVisible();
    expect(requests).toBe(2);
  } finally {
    await page.close();
  }
}, 30_000);

test("a registry read failure leaves browser settings usable", async () => {
  const page = await browser.newPage();
  try {
    await page.route("**/settings/preferences", (route) =>
      route.fulfill({ status: 503, body: "Unavailable" }),
    );
    await page.addInitScript(() =>
      sessionStorage.setItem("sb.model-setup.later", "1"),
    );
    await page.goto(`${server.url}?view=settings&tab=preferences`);
    const local = page.getByRole("radiogroup", {
      name: "Document tips",
      exact: true,
    });
    await local.getByRole("radio", { name: "Hidden", exact: true }).click();
    await browserExpect(
      local.getByRole("radio", { name: "Hidden", exact: true }),
    ).toBeChecked();
    await browserExpect(
      page.getByRole("button", { name: "Add reviewer", exact: true }),
    ).toBeEnabled();
    await page.unroute("**/settings/preferences");
    await page.reload();
    await browserExpect(
      local.getByRole("radio", { name: "Hidden", exact: true }),
    ).toBeChecked();
    await browserExpect(
      page.locator("#preference-row-replies").getByRole("radio").first(),
    ).toBeEnabled();
  } finally {
    await page.close();
  }
}, 30_000);

test("keyboard choices keep focus and save the selected option", async () => {
  const page = await browser.newPage();
  try {
    await openSettings(page);
    const row = page.locator("#preference-row-replies");
    const selected = row.getByRole("radio", { checked: true });
    const previous = (await selected.innerText()).trim();
    await selected.focus();
    await page.keyboard.press("ArrowRight");
    await browserExpect(selected).toBeFocused();
    const next = (await selected.innerText()).trim();
    expect(next).not.toBe(previous);
    await browserExpect(row.getByText("Saved", { exact: true })).toBeVisible();
    await browserExpect
      .poll(async () => (await readPreferences()).value?.["replies"])
      .toBe(next.toLowerCase());
    await page.keyboard.press("ArrowLeft");
    await browserExpect(selected).toHaveAccessibleName(previous);
    await browserExpect(selected).toBeFocused();
    await browserExpect
      .poll(async () => (await readPreferences()).value?.["replies"])
      .toBe(previous.toLowerCase());
  } finally {
    await page.close();
  }
}, 30_000);

test("settings tabs open, and sign-out ends the local session even when the hub fails", async () => {
  const page = await browser.newPage();
  try {
    await openSettings(page);
    for (const name of [
      "Providers",
      "Profiles",
      "Collaborators",
      "About",
      "Preferences",
    ]) {
      await page.getByRole("tab", { name, exact: true }).click();
      await browserExpect(
        page.getByRole("tab", { name, exact: true }),
      ).toHaveAttribute("aria-selected", "true");
    }
    await page.route("**/api/auth/sign-out", (route) =>
      route.fulfill({ status: 503, json: { message: "Try again" } }),
    );
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await browserExpect(
      page.getByRole("heading", { name: "Welcome back", exact: true }),
    ).toBeVisible();
    await page.unroute("**/api/auth/sign-out");
    await openSettings(page);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await browserExpect(
      page.getByRole("heading", { name: "Welcome back", exact: true }),
    ).toBeVisible();
  } finally {
    await page.close();
  }
}, 30_000);
