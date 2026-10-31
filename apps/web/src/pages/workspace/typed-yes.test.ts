import { expect, test } from "bun:test";
import { isAffirmation } from "./typed-yes.tsx";

test("only a whole plain affirmation approves", () => {
  for (const message of [
    "yes",
    "Yes!",
    "  OK. ",
    "go ahead",
    "Ship it!!",
    "LGTM",
    "sounds good.",
  ])
    expect(isAffirmation(message)).toBe(true);
  for (const message of [
    "yes but change the title",
    "no",
    "not ok",
    "okay?then wait",
    "",
    "yess",
  ])
    expect(isAffirmation(message)).toBe(false);
});
