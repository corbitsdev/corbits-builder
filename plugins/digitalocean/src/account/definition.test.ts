import { expect, test } from "bun:test";
import { type } from "arktype";
import { Choice, SIZES } from "../target.ts";
import account from "./definition.ts";

const held = {
  target: "digitalocean",
  place: "DigitalOcean",
  since: "2026-11-18T09:00:00.000Z",
  costs: "$12 a month",
};

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

test("the choice offered first is the person's last one", () => {
  const offered = account.prepare?.({}, undefined, {
    "digitalocean.choice": {
      size: "s-1vcpu-2gb",
      region: "fra1",
      monthly: 12,
      team: { id: "team-1" },
      at: "2026-11-18T09:00:00.000Z",
    },
  });
  expect(offered).toMatchObject({ size: "s-1vcpu-2gb", region: "fra1" });
});

test("once a server costs money at DigitalOcean the screen only signs the person in again", () => {
  expect(account.prepare?.({}, undefined, { "publish.holding": held })).toEqual(
    { mode: "signIn", costs: "$12 a month" },
  );
  // Another place's holding changes nothing here.
  expect(
    account.prepare?.({}, undefined, {
      "publish.holding": { ...held, target: "hoster" },
    }),
  ).toMatchObject({ mode: "choose" });
});

test("the answer is saved as what the person agreed to, and signing in again leaves it as it is", () => {
  const writes = account.writes?.["digitalocean.choice"];
  const saved = writes?.({
    size: "s-1vcpu-1gb",
    region: "lon1",
    monthly: 6,
    team: { id: "team-1", name: "Bakery" },
  });
  expect(saved).toMatchObject({
    size: "s-1vcpu-1gb",
    region: "lon1",
    monthly: 6,
    team: { id: "team-1", name: "Bakery" },
  });
  expect(Choice(saved)).not.toBeInstanceOf(type.errors);
  expect(writes?.({ signedIn: true })).toBeUndefined();
});

test("an answer for a size or place the screen does not offer is refused", () => {
  for (const output of [
    {
      size: "s-1vcpu-512mb-10gb",
      region: "lon1",
      monthly: 4,
      team: { id: "t" },
    },
    { size: "s-1vcpu-1gb", region: "mars1", monthly: 6, team: { id: "t" } },
    { size: "s-1vcpu-1gb", region: "lon1", monthly: 6 },
  ])
    expect(account.output(output)).toBeInstanceOf(type.errors);
});
