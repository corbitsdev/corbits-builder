import { expect, test } from "bun:test";
import {
  activeProfileId,
  asksDefaultProfile,
  defaultProfileOptions,
  initialDefaultProfile,
} from "./profiles.tsx";

test("saving a second profile asks which is the default and stores that id", () => {
  expect(asksDefaultProfile("new", 1)).toBe(true);
  expect(asksDefaultProfile("new", 2)).toBe(true);
  const options = defaultProfileOptions(
    [
      { id: "shipped", label: "Shipped" },
      { id: "custom_old", label: "Old" },
    ],
    { id: "custom_new", label: "Mine" },
  );
  expect(options.map((option) => option.id)).toEqual([
    "shipped",
    "custom_old",
    "custom_new",
  ]);
  expect(
    activeProfileId({
      ask: true,
      previous: "shipped",
      chosen: "custom_new",
    }),
  ).toBe("custom_new");
  expect(
    initialDefaultProfile({
      previous: "shipped",
      automatic: "shipped",
      createdId: "custom_new",
      existingIds: ["shipped", "custom_old"],
    }),
  ).toBe("shipped");
});

test("creating the first profile does not ask and keeps the previous active id", () => {
  expect(asksDefaultProfile("new", 0)).toBe(false);
  expect(
    activeProfileId({
      ask: false,
      previous: undefined,
      chosen: "custom_new",
    }),
  ).toBeUndefined();
});

test("editing a profile does not ask again", () => {
  expect(asksDefaultProfile("edit", 3)).toBe(false);
  expect(
    activeProfileId({
      ask: false,
      previous: "shipped",
      chosen: "custom_new",
    }),
  ).toBe("shipped");
});
