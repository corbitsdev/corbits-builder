/**
 * Settings as it looks: Providers (model connections), Profiles (which model and effort
 * each role runs on), Preferences (how Builder works with the person, the
 * look, and their account at the bottom),
 * Collaborators (roles and invitations), and About (with its open source
 * notices). Only what has a real backing shows.
 *
 * They are grouped into tabs. Each section is the library's `Section`; its
 * rows are `SettingsRow`s. The sections that read the hub arrive as slots.
 */
import { wording } from "../../config.ts";
import { Section, Switch, Tabs, type ThemeMode } from "@corbits/react-ui";
import type { ReactNode } from "react";
import { SettingsRow, SettingsRowValue } from "./settings-row.tsx";
import { SettingsSectionBody, SettingsSubhead } from "./settings-section.tsx";
import { Button, QuietSelect } from "../../components.jsx";
import { openSourceNotices } from "../../open-source.ts";
import { Credit } from "../../flourish.tsx";
import styles from "./settings.module.css";

export type SettingsTab = keyof typeof wording.settings.tab;

const SETTINGS_TABS: readonly { id: SettingsTab; label: string }[] = [
  { id: "providers", label: wording.settings.tab.providers },
  { id: "profiles", label: wording.settings.tab.profiles },
  { id: "preferences", label: wording.settings.tab.preferences },
  { id: "collaborators", label: wording.settings.tab.collaborators },
  { id: "about", label: wording.settings.tab.about },
];

const THEME_MODES: readonly ThemeMode[] = ["light", "system", "dark"];

/** The sections that read the hub for themselves, each drawn only while its tab is open. */
export type SettingsSlots = {
  providers: ReactNode;
  profiles: ReactNode;
  collaborators: ReactNode;
  /** The first section of the Preferences tab. */
  workingPreferences: ReactNode;
  /** The second, above Appearance and Account. */
  workspaceApprovals: ReactNode;
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
  /** The theme, and the document tips and questions layout choices kept in this browser. */
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
  workingPreferences,
  workspaceApprovals,
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
    if (active === "about") {
      return <About />;
    }
    return (
      <>
        {workingPreferences}
        {workspaceApprovals}
        <Appearance {...appearance} />
        {account ? <Account {...account} /> : null}
      </>
    );
  };
  return (
    <div className={styles.page} data-slot="settings-page">
      <h1>{wording.settings.title}</h1>
      <Tabs
        tabs={SETTINGS_TABS}
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
    <Section title={copy.section} description={copy.lead}>
      <SettingsSectionBody>
        <SettingsRow label={copy.theme} htmlFor="settings-theme">
          <QuietSelect
            id="settings-theme"
            value={theme}
            onChange={(event) => onThemeChange(event.target.value as ThemeMode)}
          >
            {THEME_MODES.map((option) => (
              <option key={option} value={option}>
                {copy.themes[option]}
              </option>
            ))}
          </QuietSelect>
        </SettingsRow>
        <SettingsRow
          label={wording.tips.setting}
          hint={wording.tips.settingHint}
        >
          <Switch
            label={wording.tips.setting}
            checked={documentTips}
            onCheckedChange={onDocumentTipsChange}
          />
        </SettingsRow>
      </SettingsSectionBody>
    </Section>
  );
}

/** Who is signed in, and a way out. The hub has no rename or
 * password-change endpoints, so there are no controls for them. */
function Account({ name, email, signingOut, onSignOut }: AccountProps) {
  const copy = wording.settings.account;
  return (
    <Section title={copy.section} description={copy.lead}>
      <SettingsSectionBody>
        <SettingsRow label={copy.name}>
          <SettingsRowValue>{name}</SettingsRowValue>
        </SettingsRow>
        <SettingsRow label={copy.email}>
          <SettingsRowValue>{email}</SettingsRowValue>
        </SettingsRow>
        {onSignOut ? (
          <SettingsRow>
            <Button variant="outline" loading={signingOut} onClick={onSignOut}>
              {wording.action.signOut}
            </Button>
          </SettingsRow>
        ) : null}
      </SettingsSectionBody>
    </Section>
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
