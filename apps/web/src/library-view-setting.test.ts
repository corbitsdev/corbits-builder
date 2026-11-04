import { expect, test } from "bun:test";
import { parseLibraryView } from "./library-view-setting.ts";

test("only the two layouts are read back; anything else leaves the default", () => {
  expect(parseLibraryView("grid")).toBe("grid");
  expect(parseLibraryView("rows")).toBe("rows");
  expect(parseLibraryView("tiles")).toBeNull();
  expect(parseLibraryView("")).toBeNull();
});
