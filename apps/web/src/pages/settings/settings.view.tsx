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
import { wording, type SettingsTab } from "../../config.ts";
import {
  Button as UiButton,
  Section,
  Tabs,
  type ThemeMode,
} from "@corbits/react-ui";
import { Tooltip } from "@corbits/react-ui/ui/tooltip";
import { ArrowLeft } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { SettingsRow, SettingsRowValue } from "./settings-row.tsx";
import {
  SettingsGroup,
  SettingsLead,
  SettingsSectionBody,
  SettingsSubhead,
} from "./settings-section.tsx";
import { PictureChoice, ThemePicture } from "./preference-choice.tsx";
import {
  Banner,
  BannerAction,
  Button,
  KeyHint,
  QuietState,
} from "../../components.jsx";
import { openSourceNotices } from "../../open-source.ts";
import styles from "./settings.module.css";

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

/** The sections that read the hub for themselves, each drawn only while its tab is open. */
export type SettingsSlots = {
  providers: ReactNode;
  profiles: ReactNode;
  collaborators: ReactNode;
  secrets: ReactNode;
  /** The Preferences tab's groups above Appearance and Account. */
  workingPreferences: ReactNode;
};

type AppearanceProps = {
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
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
  /** The theme kept in this browser. */
  appearance: AppearanceProps;
  /** Who is signed in; null when nobody is, and the Account section is left out. */
  account: AccountProps | null;
  /** Where Settings was opened; the arrow and Escape return there. */
  back?: { to: string; onBack: () => void };
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
  back,
}: SettingsViewProps) {
  useEscapeBack(back?.onBack);
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
      <header className={styles.header}>
        {back ? (
          <Tooltip
            label={
              <KeyHint
                label={wording.settings.backTo(back.to)}
                keys={[wording.settings.backKey]}
              />
            }
          >
            <UiButton
              type="button"
              variant="ghost"
              size="icon"
              className={styles.back}
              aria-label={wording.settings.backTo(back.to)}
              aria-keyshortcuts="Escape"
              onClick={back.onBack}
            >
              <ArrowLeft aria-hidden="true" />
            </UiButton>
          </Tooltip>
        ) : null}
        <h1>{wording.settings.title}</h1>
      </header>
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

/**
 * Escape goes back, unless a dialog, menu or list on the page takes it first, or a field is being
 * typed in.
 */
function useEscapeBack(onBack: (() => void) | undefined) {
  useEffect(() => {
    if (onBack === undefined) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest("input, textarea, select") !== null)
      )
        return;
      if (
        document.querySelector(
          '[role="dialog"], [role="menu"], [role="listbox"]',
        )
      )
        return;
      onBack();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onBack]);
}

function Appearance({ theme, onThemeChange }: AppearanceProps) {
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
    </Section>
  );
}
