import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CATALOG } from "../plugins/catalog.ts";
import { spliceDesignScreens, syncDesignScreensOnDisk } from "./starter.ts";

const STARTER = CATALOG.design!.starter;
const STARTER_INDEX = STARTER[".builder/designs/index.html"]!;
const STARTER_HOME_SCREEN = STARTER[".builder/designs/screens/home.html"]!;

describe("spliceDesignScreens", () => {
  test("is idempotent across repeated splices and replaces the marked block in place", () => {
    const first = spliceDesignScreens(STARTER_INDEX, {
      "place.html": '<section data-screen="place"><h1>Places v1</h1></section>',
    });
    expect(first).toContain("<!-- builder:screens:start -->");
    expect(first).toContain(
      '<section data-screen="place"><h1>Places v1</h1></section>',
    );
    expect(first).toContain("<!-- builder:screens:end -->");

    const repeated = spliceDesignScreens(first, {
      "place.html": '<section data-screen="place"><h1>Places v1</h1></section>',
    });
    expect(repeated).toBe(first);

    const updated = spliceDesignScreens(first, {
      "place.html": '<section data-screen="place"><h1>Places v2</h1></section>',
      "search.html": '<section data-screen="search"><h1>Search</h1></section>',
    });
    expect(updated).not.toContain("Places v1");
    expect(updated).toContain(
      '<section data-screen="place"><h1>Places v2</h1></section>',
    );
    expect(updated).toContain(
      '<section data-screen="search"><h1>Search</h1></section>',
    );
    expect(updated.match(/<!-- builder:screens:start -->/g)?.length).toBe(1);
    expect(updated.match(/<!-- builder:screens:end -->/g)?.length).toBe(1);

    const cleared = spliceDesignScreens(updated, { "empty.html": "   \n  " });
    expect(cleared).not.toContain("<!-- builder:screens:start -->");
    expect(cleared).toContain("<!-- builder:screens -->");

    const restored = spliceDesignScreens(cleared, {
      "place.html": '<section data-screen="place"><h1>Places v1</h1></section>',
    });
    expect(restored).toBe(first);
  });

  test("ignores empty screen files and skips unmodified STARTER_HOME_SCREEN when custom screens exist", () => {
    const onlyStarterHome = spliceDesignScreens(STARTER_INDEX, {
      "home.html": STARTER_HOME_SCREEN,
      "empty.html": "",
      "whitespace.html": "  \n\t  ",
    });
    expect(onlyStarterHome).toContain('data-screen="home"');
    expect(onlyStarterHome).toContain("Hello, world");
    expect(onlyStarterHome).not.toContain("empty");
    expect(onlyStarterHome).not.toContain("whitespace");

    const withCustomScreens = spliceDesignScreens(onlyStarterHome, {
      "home.html": STARTER_HOME_SCREEN,
      "place.html": '<section data-screen="place"><h1>Places</h1></section>',
      "search.html": '<section data-screen="search"><h1>Search</h1></section>',
      "blank.html": "   ",
    });
    expect(withCustomScreens).not.toContain("Hello, world");
    expect(withCustomScreens).not.toContain('data-screen="home"');
    expect(withCustomScreens).toContain('data-screen="place"');
    expect(withCustomScreens).toContain('data-screen="search"');

    const withModifiedHome = spliceDesignScreens(withCustomScreens, {
      "home.html": '<section data-screen="home"><h1>Custom Home</h1></section>',
      "place.html": '<section data-screen="place"><h1>Places</h1></section>',
    });
    expect(withModifiedHome).toContain('data-screen="home"');
    expect(withModifiedHome).toContain("Custom Home");
    expect(withModifiedHome).toContain('data-screen="place"');
  });
});

describe("syncDesignScreensOnDisk", () => {
  test("updates .builder/designs/index.html on disk and removes untouched starter home.html when custom screens are written", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "sb-starter-sync-"));
    const designs = join(workspace, ".builder", "designs");
    try {
      for (const [path, text] of Object.entries(STARTER)) {
        const target = join(workspace, path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, text);
      }

      await syncDesignScreensOnDisk(workspace);
      const initialIndex = await readFile(join(designs, "index.html"), "utf8");
      expect(initialIndex).toContain("<!-- builder:screens:start -->");
      expect(initialIndex).toContain("Hello, world");

      await writeFile(
        join(designs, "screens", "place.html"),
        '<section data-screen="place"><h1>Places</h1></section>',
      );
      await syncDesignScreensOnDisk(workspace);

      const afterFirstCustom = await readFile(
        join(designs, "index.html"),
        "utf8",
      );
      expect(afterFirstCustom).toContain("<!-- builder:screens:start -->");
      expect(afterFirstCustom).toContain('data-screen="place"');
      expect(afterFirstCustom).not.toContain("Hello, world");
      expect(
        await Bun.file(join(designs, "screens", "home.html")).exists(),
      ).toBe(false);

      await writeFile(
        join(designs, "screens", "search.html"),
        '<section data-screen="search"><h1>Search</h1></section>',
      );
      await syncDesignScreensOnDisk(workspace);

      const afterSecondCustom = await readFile(
        join(designs, "index.html"),
        "utf8",
      );
      expect(afterSecondCustom).toContain('data-screen="place"');
      expect(afterSecondCustom).toContain('data-screen="search"');
      expect(
        afterSecondCustom.match(/<!-- builder:screens:start -->/g)?.length,
      ).toBe(1);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
