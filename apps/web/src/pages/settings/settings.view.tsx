/**
 * Settings as it looks: Providers (model connections), Profiles (which model and effort
 * each role runs on), Preferences (how Builder works with the person, the
 * look, and their account at the bottom),
 * Collaborators (roles and invitations), Secrets (the keys plugins saved),
 * and About (with its open source notices). Only what has a real backing shows.
 *
 * They are grouped into tabs. Preferences and Secrets are a `SettingsGroup` per heading, the
 * other tabs' sections are the library's `Section`; their rows are
 * `SettingsRow`s. The sections that read the hub arrive as slots.
 */
import { wording } from "../../config.ts";
import { Section, Tabs, type ThemeMode } from "@corbits/react-ui";
import type { ReactNode } from "react";
import { SettingsRow, SettingsRowValue } from "./settings-row.tsx";
import {
  SettingsGroup,
  SettingsLead,
  SettingsSectionBody,
  SettingsSubhead,
} from "./settings-section.tsx";
import { ChoiceSegments } from "@corbits-builder/plugin-ui/choice-segments";
import { PictureChoice, ThemePicture } from "./preference-choice.tsx";
import { Banner, BannerAction, Button, QuietState } from "../../components.jsx";
import { openSourceNotices } from "../../open-source.ts";
import { Credit } from "../../flourish.tsx";
import styles from "./settings.module.css";

export type SettingsTab = keyof typeof wording.settings.tab;

const SETTINGS_TABS: readonly { id: SettingsTab; label: string }[] = [
  { id: "providers", label: wording.settings.tab.providers },
  { id: "profiles", label: wording.settings.tab.profiles },
  { id: "preferences", label: wording.settings.tab.preferences },
  { id: "collaborators", label: wording.settings.tab.collaborators },
  { id: "secrets", label: wording.settings.tab.secrets },
  { id: "about", label: wording.settings.tab.about },
];

const THEME_OPTIONS = (["light", "system", "dark"] as const).map((mode) => ({
  id: mode,
  label: wording.settings.appearance.themes[mode],
  picture: <ThemePicture mode={mode} />,
}));

const TIPS_OPTIONS = (["on", "off"] as const).map((shown) => ({
  id: shown,
  label: wording.settings.appearance.tipsChoices[shown],
}));

/** The sections that read the hub for themselves, each drawn only while its tab is open. */
export type SettingsSlots = {
  providers: ReactNode;
  profiles: ReactNode;
  collaborators: ReactNode;
  /** Its tab shows only when it is given. */
  secrets?: ReactNode;
  /** The Preferences tab's groups above Appearance and Account. */
  workingPreferences: ReactNode;
};

type AppearanceProps = {
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  /** Documents show their tips. */
  documentTips: boolean;
  onDocumentTipsChange: (shown: boolean) => void;
};

type AccountProps = {
  name: string;
  email: string;
  signingOut: boolean;
  /** Null where there is no way to sign out, and the button is left out. */
  onSignOut: (() => void) | null;
};

export type SettingsViewProps = SettingsSlots & {
  /** The open tab. */
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  /** Keep lower sections out of the first paint until the hub-backed groups are known. */
  preferencesLoad:
    | { state: "loading" }
    | { state: "failed"; fault: string; onRetry: () => void }
    | { state: "ready" };
  /** The theme and the document tips choice kept in this browser. */
  appearance: AppearanceProps;
  /** Who is signed in; null when nobody is, and the Account section is left out. */
  account: AccountProps | null;
};

export function SettingsView({
  tab,
  onTabChange,
  providers,
  profiles,
  collaborators,
  secrets,
  workingPreferences,
  preferencesLoad,
  appearance,
  account,
}: SettingsViewProps) {
  const renderTabContent = (active: SettingsTab) => {
    if (active === "providers") {
      return providers;
    }
    if (active === "profiles") {
      return profiles;
    }
    if (active === "collaborators") {
      return collaborators;
    }
    if (active === "secrets") {
      return secrets;
    }
    if (active === "about") {
      return <About />;
    }
    return (
      <>
        <SettingsLead>{wording.settings.preferences.lead}</SettingsLead>
        {preferencesLoad.state === "loading" ? (
          <div role="status">
            <QuietState tone="loading">
              {wording.settings.preferences.loading}
            </QuietState>
          </div>
        ) : (
          <>
            {preferencesLoad.state === "failed" ? (
              <Banner tone="error" title={preferencesLoad.fault}>
                <BannerAction>
                  <Button variant="outline" onClick={preferencesLoad.onRetry}>
                    {wording.action.retry}
                  </Button>
                </BannerAction>
              </Banner>
            ) : (
              workingPreferences
            )}
            <Appearance {...appearance} />
            {account ? <Account {...account} /> : null}
          </>
        )}
      </>
    );
  };
  return (
    <div className={styles.page} data-slot="settings-page">
      <h1>{wording.settings.title}</h1>
      <Tabs
        tabs={
          secrets === undefined
            ? SETTINGS_TABS.filter((entry) => entry.id !== "secrets")
            : SETTINGS_TABS
        }
        active={tab}
        onChange={onTabChange}
        label={wording.settings.sections}
        className={styles.tabs}
      >
        {renderTabContent}
      </Tabs>
    </div>
  );
}

function Appearance({
  theme,
  onThemeChange,
  documentTips,
  onDocumentTipsChange,
}: AppearanceProps) {
  const copy = wording.settings.appearance;
  return (
    <SettingsGroup title={copy.section} lead={copy.lead}>
      <SettingsRow
        layout="columns"
        label={copy.theme}
        hint={copy.themeHint}
        htmlFor="settings-theme"
      >
        <PictureChoice
          id="settings-theme"
          label={copy.theme}
          options={THEME_OPTIONS}
          choice={theme}
          onChoose={(mode) => onThemeChange(mode as ThemeMode)}
        />
      </SettingsRow>
      <SettingsRow
        layout="columns"
        label={copy.tips}
        hint={copy.tipsHint}
        htmlFor="settings-tips"
      >
        <ChoiceSegments
          id="settings-tips"
          label={copy.tips}
          options={TIPS_OPTIONS}
          choice={documentTips ? "on" : "off"}
          onChoose={(shown) => onDocumentTipsChange(shown === "on")}
        />
      </SettingsRow>
    </SettingsGroup>
  );
}

/** Who is signed in, and a way out. The hub has no rename or
 * password-change endpoints, so there are no controls for them. */
function Account({ name, email, signingOut, onSignOut }: AccountProps) {
  return (
    <SettingsGroup title={wording.settings.account.section}>
      <SettingsRow label={name} hint={email}>
        {onSignOut ? (
          <Button variant="outline" loading={signingOut} onClick={onSignOut}>
            {wording.action.signOut}
          </Button>
        ) : null}
      </SettingsRow>
    </SettingsGroup>
  );
}

function About() {
  const copy = wording.settings.about;
  return (
    <Section title={copy.section} description={copy.lead}>
      <SettingsSectionBody>
        <SettingsSubhead>{copy.openSource}</SettingsSubhead>
        <p>{copy.openSourceLead}</p>
        {openSourceNotices.map((notice) => (
          <SettingsRow key={notice.name} label={notice.name} hint={notice.use}>
            <SettingsRowValue>
              {copy.kind[notice.kind]}
              <a href={notice.link} target="_blank" rel="noreferrer">
                {notice.license ?? copy.unconfirmed}
              </a>
            </SettingsRowValue>
          </SettingsRow>
        ))}
      </SettingsSectionBody>
      <Credit />
    </Section>
  );
}
