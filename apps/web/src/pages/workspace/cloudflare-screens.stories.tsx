import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import cloudflare from "@plugins/cloudflare/package.json";
import accountDefinition, {
  text,
} from "@plugins/cloudflare/src/account/definition.ts";
import AccountView from "@plugins/cloudflare/src/account/view.tsx";
import { ScreenStory, storyScreen } from "./screen-story.tsx";

const accountScreen = storyScreen(
  "@corbits-builder/cloudflare account",
  cloudflare.builder.actions["account"],
  { screen: accountDefinition, view: AccountView, data: undefined },
);

const RELEASE_AT = "2026-11-18T10:00:00.000Z";

// An app published in a temporary account that Cloudflare removes at keepUntil unless it is kept.
const onTemporaryAccount = (keepUntil: Date) => ({
  "cloudflare.site": {
    account: "account",
    script: "app",
    temporary: true,
    keepUntil: keepUntil.toISOString(),
  },
  "publish.release": {
    target: "cloudflare",
    url: "https://app.bolder-advantage.workers.dev/",
    version: "abc123",
    at: RELEASE_AT,
  },
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
    project: onTemporaryAccount(new Date(Date.now() + 40 * 60_000)),
  },
};

/** The deadline to keep the temporary account has passed: there is nothing left to keep. */
export const AccountAfterDeadline: Story = {
  args: {
    project: onTemporaryAccount(new Date(Date.now() - 10 * 60_000)),
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

/** Taking down an app in the person's own account: only the token for that account is asked for. */
export const TakeDown: Story = {
  args: {
    project: {
      ...onTemporaryAccount(new Date(Date.now() - 10 * 60_000)),
      "cloudflare.site": {
        account: "account",
        script: "app",
        temporary: false,
      },
      ...TAKE_DOWN,
    },
    output: { account: "own", saved: true, takeDown: true },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText(text.takeDown.title)).toBeVisible();
    await expect(canvas.getByText(text.takeDown.about)).toBeVisible();
    await expect(
      canvas.queryByRole("button", { name: text.temporary.go }),
    ).toBeNull();
    await expect(canvas.queryByRole("checkbox")).toBeNull();
  },
};

/** Taking down an app on a temporary account never kept: Cloudflare removes it on its own. */
export const TakeDownBeforeRemoval: Story = {
  args: {
    project: {
      ...onTemporaryAccount(new Date(Date.now() + 40 * 60_000)),
      "publish.keep": KEEP,
      ...TAKE_DOWN,
    },
    output: { account: "own", saved: true, takeDown: true },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText(text.takeDown.title)).toBeVisible();
    await expect(
      canvas.queryByRole("button", { name: text.temporary.go }),
    ).toBeNull();
  },
};

/** The deadline to keep it passed: if it was never kept, there is nothing left to take down. */
export const TakeDownAfterRemoval: Story = {
  args: {
    project: {
      ...onTemporaryAccount(new Date(Date.now() - 10 * 60_000)),
      "publish.keep": KEEP,
      ...TAKE_DOWN,
    },
    output: { account: "own", saved: true, takeDown: true },
  },
};

export const TokenSavedToTakeDown: Story = {
  args: {
    state: "answered",
    output: { account: "own", saved: true, takeDown: true },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText(text.takeDown.title)).toBeVisible();
    await expect(canvas.getByText(text.settled.own)).toBeVisible();
  },
};

export const StartedWithoutAccount: Story = { args: { state: "answered" } };

export const TokenSaved: Story = {
  args: { state: "answered", output: { account: "own", saved: true } },
};
