import type { Meta, StoryObj } from "@storybook/react-vite";
import cloudflare from "@plugins/cloudflare/package.json";
import accountDefinition from "@plugins/cloudflare/src/account/definition.ts";
import AccountView from "@plugins/cloudflare/src/account/view.tsx";
import { ScreenStory, storyScreen } from "./screen-story.tsx";

const accountScreen = storyScreen(
  "@corbits-builder/cloudflare account",
  cloudflare.builder.actions["account"],
  { screen: accountDefinition, view: AccountView, data: undefined },
);

const RELEASE_AT = "2026-11-18T10:00:00.000Z";

const RELEASE = {
  "publish.release": {
    target: "cloudflare",
    url: "https://app.bolder-advantage.workers.dev/",
    version: "abc123",
    at: RELEASE_AT,
  },
};
// A deadline to keep the app that is still ahead, and one that has passed, as of when the stories
// load.
const KEEPABLE = new Date(Date.now() + 40 * 60_000);
const LAPSED = new Date(Date.now() - 10 * 60_000);

// An app published in a temporary account that Cloudflare removes at keepUntil unless it is kept.
const onTemporaryAccount = (keepUntil: Date) => ({
  "cloudflare.site": {
    account: "account",
    script: "app",
    temporary: true,
    keepUntil: keepUntil.toISOString(),
  },
  ...RELEASE,
});

const meta = {
  title: "Screens/Plugins/Cloudflare",
  component: ScreenStory,
  args: {
    screen: accountScreen,
    state: "open",
    input: {},
    project: {},
    output: { account: "temporary", accepted: true },
  },
} satisfies Meta<typeof ScreenStory>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The first time: publish without an account once the terms are accepted, or with their own. */
export const Account: Story = {};

/** The app is in a temporary account the person can still keep: keeping it and a token come first. */
export const AccountWhileKeepable: Story = {
  args: {
    project: onTemporaryAccount(KEEPABLE),
  },
};

/** The deadline to keep the temporary account has passed: there is nothing left to keep. */
export const AccountAfterDeadline: Story = {
  args: {
    project: onTemporaryAccount(LAPSED),
  },
};

const KEEP = {
  link: "https://dash.cloudflare.com/claim/story-only",
  until: RELEASE_AT,
  place: "Cloudflare",
};
// The person agreed on the take-down screen to take down the recorded release.
const TAKE_DOWN = {
  "publish.take-down": { target: "cloudflare", release: RELEASE_AT },
};
// The token saved for the person's own account, to take the app down there.
const OWN_TAKE_DOWN = { account: "own", saved: true, takeDown: true };

/** Taking down an app in the person's own account: only the token for that account is asked for. */
export const TakeDown: Story = {
  args: {
    project: {
      "cloudflare.site": {
        account: "account",
        script: "app",
        temporary: false,
      },
      ...RELEASE,
      ...TAKE_DOWN,
    },
    output: OWN_TAKE_DOWN,
  },
};

/** Taking down an app on a temporary account never kept: Cloudflare removes it on its own. */
export const TakeDownBeforeRemoval: Story = {
  args: {
    project: {
      ...onTemporaryAccount(KEEPABLE),
      "publish.keep": KEEP,
      ...TAKE_DOWN,
    },
    output: OWN_TAKE_DOWN,
  },
};

/** The deadline to keep it passed: if it was never kept, there is nothing left to take down. */
export const TakeDownAfterRemoval: Story = {
  args: {
    project: {
      ...onTemporaryAccount(LAPSED),
      "publish.keep": KEEP,
      ...TAKE_DOWN,
    },
    output: OWN_TAKE_DOWN,
  },
};

export const TokenSavedToTakeDown: Story = {
  args: {
    state: "answered",
    output: OWN_TAKE_DOWN,
  },
};

export const StartedWithoutAccount: Story = { args: { state: "answered" } };

export const TokenSaved: Story = {
  args: { state: "answered", output: { account: "own", saved: true } },
};
