import { defineScreen, parsed } from "@corbits-builder/plugin";
import {
  KEEP,
  RELEASE,
  PublishKeep,
  PublishRelease,
  takeDownAgreed,
} from "@corbits-builder/publishing";
import { type } from "arktype";
import {
  CloudflareSite,
  PRIVACY_POLICY,
  SITE,
  TARGET,
  TERMS,
  TERMS_OF_SERVICE,
} from "../target.ts";

// The person's answer: they accepted Cloudflare's terms for a temporary account, or saved a key
// for their own account (to take the app down when takeDown is set). A settled screen draws only
// from its answer, so the answer records which one it was.
export const Output = type({
  "+": "reject",
  account: "'temporary'",
  accepted: "true",
}).or({ "+": "reject", account: "'own'", saved: "true", "takeDown?": "true" });

// Whether the app is already in a temporary account: none (nothing this screen mentions), keepable
// (the person can still keep it) or lapsed (the time to keep it has passed).
export type Temporary = "none" | "keepable" | "lapsed";

/**
 * The screen's mode. In publish mode the person chooses an account. In takeDown mode they already
 * agreed on the take-down screen, and only a key for the app's account will do. For an app in a
 * temporary account they never said they kept, `unkept` says when Cloudflare removes it by itself.
 */
export type Prepared =
  | { mode: "publish"; temporary: Temporary }
  | { mode: "takeDown"; unkept?: { until: string; passed: boolean } };

// A time as the person reads it, such as "Nov 19, 2026, 3:40 PM".
const when = (at: string) =>
  new Date(at).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

// What the person reads on this screen.
export const text = {
  label: "Your Cloudflare account",
  title: "Publish to Cloudflare",
  temporary: {
    heading: "Start without a Cloudflare account",
    about:
      "Your app goes online now. To keep it, sign in to Cloudflare or make a free account from the screen that shows where the app is published within about an hour, or Cloudflare removes it. Publishing changes later needs that account.",
    acceptBefore: "I accept Cloudflare's ",
    terms: "Terms of Service",
    and: " and ",
    privacy: "Privacy Policy",
    go: "Publish without an account",
  },
  own: {
    heading: "Use my Cloudflare account",
    // Account API tokens, and the permission names Cloudflare's dashboard gives them:
    // https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/
    // https://developers.cloudflare.com/fundamentals/api/reference/permissions/
    about:
      "Paste an API token from your Cloudflare dashboard. Make it under Manage account, then Account API tokens, with these permissions: Workers Scripts Edit, D1 Edit and Account Settings Read.",
  },
  // For an app already on Cloudflare in a temporary account Builder made.
  already: {
    keepable:
      "To publish changes to the app you have now, keep it from the screen that shows where the app is published, then add a token for that account below. Publishing without an account puts a new copy at a new address instead, and the first one can no longer be kept from Builder.",
    lapsed:
      "The time to keep your app has passed. If you kept it, add a token for that account below to publish changes. If not, Cloudflare has removed it, and publishing without an account puts it at a new address.",
  },
  // Once the person agreed to take the app down and no key for its account is saved.
  takeDown: {
    title: "Take your app down from Cloudflare",
    about:
      "To take it down, Builder needs an API token for the Cloudflare account your app is in.",
    pending: (until: string) =>
      `Your app is on a temporary account. If you don't keep it, Cloudflare removes it by itself on ${when(until)}, so there may be nothing to do. If you kept it, Builder needs an API token for that account to take it down.`,
    passed: (until: string) =>
      `Your app went out on a temporary account. If you never kept it, Cloudflare removed it on ${when(until)}, so there's nothing to take down. If you kept it, Builder needs an API token for that account to take it down.`,
  },
  terms: { href: TERMS_OF_SERVICE },
  privacy: { href: PRIVACY_POLICY },
  settled: {
    temporary: "Publish without an account",
    own: "Cloudflare token saved",
  },
};

export default defineScreen({
  input: type({ "+": "reject" }),
  output: Output,
  // When the person agreed to take the app down, the screen shows only that. Otherwise what they
  // are told depends on whether the app is in a temporary account on Cloudflare and whether it can
  // still be kept; the account itself is not shown. A temporary account the app never reached is
  // recorded too, and changes nothing here. The screen checks only whether a keep link is
  // recorded, not the link itself. Once the person cleared it, because they kept the app or saw it
  // gone, the screen does not say that Cloudflare removes the app by itself.
  prepare: (_input, _data, project): Prepared => {
    const site = parsed(CloudflareSite(project[SITE.name]));
    const release = parsed(PublishRelease(project[RELEASE.name]));
    const onTemporary = site?.temporary === true && release?.target === TARGET;
    const keepUntil = onTemporary ? site.keepUntil : undefined;
    const passed =
      keepUntil !== undefined && new Date(keepUntil).getTime() <= Date.now();
    if (takeDownAgreed(project, TARGET)) {
      const keeping = parsed(PublishKeep(project[KEEP.name])) !== undefined;
      return keepUntil === undefined || !keeping
        ? { mode: "takeDown" }
        : { mode: "takeDown", unkept: { until: keepUntil, passed } };
    }
    if (!onTemporary) return { mode: "publish", temporary: "none" };
    return {
      mode: "publish",
      temporary: keepUntil !== undefined && !passed ? "keepable" : "lapsed",
    };
  },
  // Only this answer records an acceptance, and it is good for one temporary account. Choosing
  // their own account clears any earlier acceptance, so it cannot create a temporary account later.

  writes: {
    [TERMS.name]: (output) =>
      output.account === "temporary" ? new Date().toISOString() : null,
  },
  describe: {
    says: {
      label: () => text.label,
      chose: (output) => text.settled[output.account],
    },
    summary:
      'Offers the person two ways to publish the app to Cloudflare: without a Cloudflare account, where they accept Cloudflare\'s Terms of Service and Privacy Policy and then have about an hour to keep the app from the screen that shows where the app is published; or with their own Cloudflare account, by saving a token for it. The answer is { account: "temporary", accepted: true }, saving their acceptance as cloudflare.terms, or { account: "own", saved: true }, clearing any earlier acceptance; the publish can then start. Once the person agreed on publish take-down to take the app down, it asks only for a token for the account the app is in, saying, for an app in a temporary account they never said they kept, when Cloudflare removes it by itself; the answer is then { account: "own", saved: true, takeDown: true }, and the take-down can start.',
    when: "The app is to be published to Cloudflare and neither a Cloudflare token is saved nor has the person accepted Cloudflare's terms for a new temporary account within the hour, or they want to change which account it goes to; or they agreed to take it down from Cloudflare and no token is saved.",
    unless:
      "A Cloudflare token is saved or cloudflare.terms was set within the hour, and they did not ask to change it.",
    fields: {},
  },
});
