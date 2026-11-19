import { defineScreen } from "@corbits-builder/plugin";
import {
  PUBLISH_HOLDING,
  PublishHolding,
} from "@corbits-builder/plugin/publish";
import { type } from "arktype";
import {
  CHOICE,
  Choice,
  monthlyWords,
  QUOTE,
  Quote,
  REGIONS,
  RegionSlug,
  SIZES,
  SizeSlug,
  TARGET,
  type Choice as Chosen,
} from "../target.ts";

// The person's answer: the server they agreed to rent, with the price they were shown and the team
// their sign-in bills. Once a server exists, the answer says only that they signed in again.
export const Output = type({
  "+": "reject",
  size: SizeSlug,
  region: RegionSlug,
  monthly: "number > 0",
  team: { "+": "reject", id: "string > 0", "name?": "string > 0" },
}).or({ "+": "reject", signedIn: "true" });
export type Output = typeof Output.infer;

/** A size as the screen offers it, at the live price when one was recorded for it. */
export type SizeOffer = {
  slug: (typeof SIZES)[number]["slug"];
  memory: string;
  disk: string;
  monthly: number;
};

/**
 * What the screen shows: the sizes and regions to choose from, preset to the person's last choice.
 * Once a server exists and costs money, it shows only a sign-in, and costs is what is held there.
 */
export type Prepared =
  | {
      mode: "choose";
      sizes: readonly SizeOffer[];
      size: SizeOffer["slug"];
      region: (typeof REGIONS)[number]["slug"];
    }
  | { mode: "signIn"; costs: string | undefined };

const sizeOf = (slug: string) => SIZES.find((size) => size.slug === slug);
const cityOf = (slug: string) =>
  REGIONS.find((region) => region.slug === slug)?.city ?? slug;

export const text = {
  title: "Publish to DigitalOcean",
  about:
    "Builder sets up a server for your app in your DigitalOcean account, and DigitalOcean bills you for it each month until you take the app down. Choose a size and where it runs, then sign in and pick the team that pays.",
  signedOut: "Sign in to DigitalOcean again so Builder can reach your server.",
  size: "Size",
  region: "Where it runs",
  regionHint: "Choose the place nearest the people who'll use your app.",
  sizeLabel: (size: SizeOffer) =>
    `${size.memory} memory, ${size.disk} disk, ${monthlyWords(size.monthly)}`,
  smallest: "Enough for most apps.",
  noTeam:
    "DigitalOcean didn't say which team this sign-in is for. Sign in again to choose the team that pays.",
  warning: (costs: string | undefined) =>
    `Disconnecting doesn't delete your server${costs === undefined ? "" : `, which costs ${costs}`}. To delete it, take the app down from the Publish tab.`,
  settled: (output: Output) =>
    "size" in output
      ? `${sizeOf(output.size)?.memory ?? output.size} server in ${cityOf(output.region)}, ${monthlyWords(output.monthly)}${output.team.name === undefined ? "" : `, billed to ${output.team.name}`}`
      : "Signed in to DigitalOcean",
};

/** The sizes offered, using the live price a tool recorded when it differed from the listed one. */
function offeredSizes(project: Readonly<Record<string, unknown>>) {
  const quote = Quote(project[QUOTE]);
  return SIZES.map(({ slug, memory, disk, monthly }): SizeOffer => ({
    slug,
    memory,
    disk,
    monthly:
      quote instanceof type.errors || quote.size !== slug
        ? monthly
        : quote.monthly,
  }));
}

/** What the project holds at DigitalOcean, as the Publish tab shows it, or undefined. */
function heldHere(project: Readonly<Record<string, unknown>>) {
  const held = PublishHolding(project[PUBLISH_HOLDING]);
  return held instanceof type.errors || held.target !== TARGET
    ? undefined
    : held;
}

export default defineScreen({
  input: type({ "+": "reject" }),
  output: Output,
  // Once something costs money at DigitalOcean the size is settled and the screen only signs the
  // person in again. Before that it offers the choice, preset to their last one.
  prepare: (_input, _data, project): Prepared => {
    const held = heldHere(project);
    if (held !== undefined) return { mode: "signIn", costs: held.costs };
    const earlier = Choice(project[CHOICE]);
    const chosen = earlier instanceof type.errors ? undefined : earlier;
    return {
      mode: "choose",
      sizes: offeredSizes(project),
      size: chosen?.size ?? SIZES[0].slug,
      region: chosen?.region ?? REGIONS[0].slug,
    };
  },
  // Only a choose answer writes the choice. Signing in again leaves it as it is.
  writes: {
    [CHOICE]: (output) => {
      if (!("size" in output)) return undefined;
      const choice: Chosen = {
        size: output.size,
        region: output.region,
        monthly: output.monthly,
        team: output.team,
        at: new Date().toISOString(),
      };
      return choice;
    },
  },
  describe: {
    says: {
      label: () => text.title,
      chose: text.settled,
    },
    summary:
      "Has the person choose the size of the server Builder makes for their app at DigitalOcean and where it runs, each size with its monthly price, and sign in to DigitalOcean, choosing there the team that pays. The answer is { size, region, monthly, team }, saved as digitalocean.choice: what the person agreed to rent. While a server is made already it only signs them in again, and the answer is { signedIn: true }.",
    when: "The app is to be published to DigitalOcean and the person has not chosen a server there yet, wants to change it before one is made, or a DigitalOcean tool said the price or the team changed, or that they must sign in again.",
    unless:
      "The person chose a server here and nothing since said the price, the team or their sign-in changed.",
    fields: {},
  },
});
