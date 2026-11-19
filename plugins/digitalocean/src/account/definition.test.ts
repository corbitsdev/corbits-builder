import { expect, test } from "bun:test";
import { SIZES } from "../target.ts";
import account from "./definition.ts";

test("the sizes are offered at the price listed, or the live one a tool recorded for that size", () => {
  const quoted = SIZES[0];
  const unquoted = SIZES[1];
  const offered = account.prepare?.({}, undefined, {
    "digitalocean.quote": { size: quoted.slug, monthly: quoted.monthly + 1 },
  });
  if (offered?.mode !== "choose") throw new Error("no sizes offered");
  const monthlyOf = (slug: string) =>
    offered.sizes.find((size) => size.slug === slug)?.monthly;
  expect(monthlyOf(quoted.slug)).toBe(quoted.monthly + 1);
  expect(monthlyOf(unquoted.slug)).toBe(unquoted.monthly);
});
