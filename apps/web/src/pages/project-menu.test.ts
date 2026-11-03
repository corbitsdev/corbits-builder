import { expect, test } from "bun:test";
import { updateOutcome } from "./project-menu.tsx";

test("an update that replaced runs reads as done, and one that waits says why", () => {
  expect(updateOutcome({ updated: true })).toEqual([
    "The project is updated. Ask the coordinator to carry on.",
    true,
  ]);
  const [why, complete] = updateOutcome({
    updated: false,
    reason: "specialist_working",
  });
  expect(why).toMatch(/mid-task/);
  expect(complete).toBe(false);
  expect(updateOutcome({ updated: false })[0]).toBe(
    "The project was not updated.",
  );
});
