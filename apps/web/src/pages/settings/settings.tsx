/**
 * Settings: Providers (model connections), Profiles (which model and effort
 * each role runs on), Preferences (how Builder works with the person, the
 * look, and their account at the bottom),
 * Collaborators (roles and invitations), and About (with its open source
 * notices). Only what has a real backing shows.
 *
 * They are grouped into tabs; the open tab is `?tab=` beside `?view=settings`,
 * so each one can be linked. Each section is the library's `Section`; its
 * rows are `SettingsRow`s.
 */
import { wording } from "../../config.ts";
import {
  Section,
  Switch,
  Tabs,
  useTheme,
  type ThemeMode,
} from "@corbits/react-ui";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { keys } from "../../queries/keys.ts";
import { ProvidersSection } from "./providers.jsx";
import { Profiles } from "./profiles.jsx";
import {
  useDocumentTips,
  writeDocumentTips,
} from "../../document-tips-setting.ts";
import {
  useQuestionsLayout,
  writeQuestionsLayout,
} from "../../questions-layout-setting.ts";
import {
  useWorkspaceApprovalsEnabled,
  writeWorkspaceApprovalsEnabled,
  type OnOff,
} from "../../workspace-approvals-setting.ts";
import { SettingsRow, SettingsRowValue } from "./settings-row.tsx";
import { SettingsSectionBody, SettingsSubhead } from "./settings-section.tsx";
import { WorkspaceApprovals } from "./workspace-approvals.tsx";
import { Collaborators } from "./collaborators.jsx";
import { Banner, Button, QuietSelect, QuietState } from "../../components.jsx";
import { productClient } from "../../api/transport.ts";
import { workspaceTenantId, type HubUser } from "../../api/auth.ts";
import { openSourceNotices } from "../../open-source.ts";
import { Credit } from "../../flourish.tsx";
import type {
  PreferenceRegistry,
  Preferences,
} from "@corbits-builder/schemas/preferences";
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

function isSettingsTab(value: string | null): value is SettingsTab {
  return SETTINGS_TABS.some((tab) => tab.id === value);
}

function tabInUrl(): SettingsTab {
  if (typeof window === "undefined") return "providers";
  const requested = new URLSearchParams(window.location.search).get("tab");
  return isSettingsTab(requested) ? requested : "providers";
}

function focusInUrl(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const requested = new URLSearchParams(window.location.search).get("focus");
  return requested !== null && requested.length > 0 ? requested : undefined;
}

/** Replaces rather than pushes, so switching tabs never adds a Back step. */
function writeSearch(edit: (search: URLSearchParams) => void): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  edit(url.searchParams);
  window.history.replaceState(window.history.state, "", url);
}

/** Keeps the open tab in the address bar while Settings is shown, and takes
 * back on leaving only the parameters it added. */
function useTabInUrl(
  requestedTab?: SettingsTab,
  focusPreference?: string,
  focusSeq?: number,
): [SettingsTab, (tab: SettingsTab) => void] {
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => {
    if (requestedTab !== undefined) return requestedTab;
    if (focusPreference !== undefined || focusInUrl() !== undefined) {
      return "preferences";
    }
    return tabInUrl();
  });
  useEffect(() => {
    if (requestedTab !== undefined) {
      setActiveTab(requestedTab);
    } else if (focusPreference !== undefined || focusInUrl() !== undefined) {
      setActiveTab("preferences");
    }
  }, [requestedTab, focusPreference, focusSeq]);
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onPopState = () => setActiveTab(tabInUrl());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => {
    const addedView =
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("view") !== "settings";
    return () =>
      writeSearch((search) => {
        search.delete("tab");
        search.delete("focus");
        if (addedView && search.get("view") === "settings")
          search.delete("view");
      });
  }, []);
  useEffect(() => {
    writeSearch((search) => {
      search.set("view", "settings");
      search.set("tab", activeTab);
      if (activeTab === "preferences" && focusPreference !== undefined) {
        search.set("focus", focusPreference);
      }
    });
  }, [activeTab, focusPreference, focusSeq]);
  return [activeTab, setActiveTab];
}

export function Settings({
  onChanged,
  user = null,
  onSignOut,
  requestedTab,
  focusPreference,
  focusSeq = 0,
}: {
  onChanged: () => void;
  /** Who is signed in; the Account section names them. */
  user?: HubUser | null;
  onUserChanged?: (user: HubUser) => void;
  onSignOut?: () => Promise<void>;
  requestedTab?: SettingsTab;
  focusPreference?: string;
  focusSeq?: number;
}) {
  const effectiveFocus = focusPreference ?? focusInUrl();
  const [activeTab, setActiveTab] = useTabInUrl(
    requestedTab,
    effectiveFocus,
    focusSeq,
  );
  const renderTabContent = (active: SettingsTab) => {
    if (active === "providers") {
      return <ProvidersSection onChanged={onChanged} />;
    }
    if (active === "profiles") {
      return <Profiles />;
    }
    if (active === "collaborators") {
      return <Collaborators user={user} />;
    }
    if (active === "about") {
      return <About />;
    }
    return (
      <>
        <WorkingPreferences
          {...(effectiveFocus !== undefined
            ? { focusPreference: effectiveFocus }
            : {})}
          focusSeq={focusSeq}
        />
        <WorkspaceApprovals />
        <Appearance />
        {user ? (
          <Account user={user} {...(onSignOut ? { onSignOut } : {})} />
        ) : null}
      </>
    );
  };
  return (
    <div className={styles.page} data-slot="settings-page">
      <h1>{wording.settings.title}</h1>
      <Tabs
        tabs={SETTINGS_TABS}
        active={activeTab}
        onChange={setActiveTab}
        label={wording.settings.sections}
        className={styles.tabs}
      >
        {renderTabContent}
      </Tabs>
    </div>
  );
}

/** The theme, and the document tips and questions layout choices kept in this browser. */
function Appearance() {
  const { mode, setMode } = useTheme();
  const tips = useDocumentTips();
  const questionsLayout = useQuestionsLayout();
  const copy = wording.settings.appearance;
  return (
    <Section title={copy.section} description={copy.lead}>
      <SettingsSectionBody>
        <SettingsRow label={copy.theme} htmlFor="settings-theme">
          <QuietSelect
            id="settings-theme"
            value={mode}
            onChange={(event) => setMode(event.target.value as ThemeMode)}
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
            checked={tips === "on"}
            onCheckedChange={(on) => writeDocumentTips(on ? "on" : "off")}
          />
        </SettingsRow>
        <SettingsRow
          label={wording.questions.layoutSetting}
          hint={wording.questions.layoutHint}
        >
          <Switch
            label={wording.questions.layoutSetting}
            checked={questionsLayout === "steps"}
            onCheckedChange={(on) => writeQuestionsLayout(on ? "steps" : "all")}
          />
        </SettingsRow>
      </SettingsSectionBody>
    </Section>
  );
}

type SaveState = "saving" | "saved" | "failed";

const SAVE_TONES = {
  saving: "loading",
  saved: "success",
  failed: "error",
} as const;

type PreferenceItem = {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly options: readonly { readonly id: string; readonly label: string }[];
  readonly default: string;
};

/** A preference whose only choices are Off and On, shown as a switch. */
function isOnOff(preference: PreferenceItem): boolean {
  return preference.options.map((option) => option.id).join() === "no,yes";
}

function mergeExperimentalPreferences(
  loaded: PreferenceRegistry["preferences"] | null,
): readonly PreferenceItem[] {
  if (loaded === null) {
    return wording.settings.preferences.experimental;
  }
  const extras = wording.settings.preferences.experimental.filter(
    (exp) => !loaded.some((item) => item.id === exp.id),
  );
  return [...loaded, ...extras];
}

function resolvePreferenceChoice(
  preference: PreferenceItem,
  fieldValue: Preferences | null | undefined,
  approvalsEnabled: OnOff,
): string {
  if (preference.id === "experimental_approvals") {
    return approvalsEnabled === "on" ? "yes" : "no";
  }
  return fieldValue?.[preference.id] ?? preference.default;
}

function syncExperimentalPreference(id: string, choice: string): boolean {
  if (id === "experimental_approvals") {
    writeWorkspaceApprovalsEnabled(choice === "yes" ? "on" : "off");
    return true;
  }
  return false;
}

/** The person's working preferences, from the hub's registry and kept by the hub, which
 * delivers them to every role they apply to. Each change saves as it is made. */
export function WorkingPreferences({
  focusPreference,
  focusSeq = 0,
}: {
  focusPreference?: string;
  focusSeq?: number;
} = {}) {
  const queryClient = useQueryClient();
  const approvalsEnabled = useWorkspaceApprovalsEnabled();
  const [registry, setRegistry] = useState<
    PreferenceRegistry["preferences"] | null
  >(null);
  const [field, setField] = useState<{
    value: Preferences | null;
    version: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [save, setSave] = useState<{ id: string; state: SaveState } | null>(
    null,
  );
  const [highlightedId, setHighlightedId] = useState<string | null>(
    focusPreference ?? null,
  );
  useEffect(() => {
    if (!focusPreference || typeof document === "undefined") return;
    setHighlightedId(focusPreference);

    const jumpToPreference = () => {
      const controlEl = document.getElementById(
        `preference-${focusPreference}`,
      );
      const rowEl =
        document.getElementById(`preference-row-${focusPreference}`) ??
        (controlEl?.closest(
          '[data-slot="settings-row"]',
        ) as HTMLElement | null);
      if (rowEl) {
        rowEl.setAttribute("data-highlighted", "");
        if (typeof rowEl.scrollIntoView === "function") {
          rowEl.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
      if (controlEl instanceof HTMLElement) {
        controlEl.focus({ preventScroll: true });
      }
    };

    jumpToPreference();
    const rafId =
      registry !== null &&
      typeof window !== "undefined" &&
      typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame(jumpToPreference)
        : undefined;
    const timerId = setTimeout(() => {
      setHighlightedId((current) =>
        current === focusPreference ? null : current,
      );
      const controlEl = document.getElementById(
        `preference-${focusPreference}`,
      );
      const rowEl =
        document.getElementById(`preference-row-${focusPreference}`) ??
        (controlEl?.closest(
          '[data-slot="settings-row"]',
        ) as HTMLElement | null);
      rowEl?.removeAttribute("data-highlighted");
    }, 2_000);

    return () => {
      if (
        rafId !== undefined &&
        typeof window !== "undefined" &&
        typeof window.cancelAnimationFrame === "function"
      ) {
        window.cancelAnimationFrame(rafId);
      }
      clearTimeout(timerId);
    };
  }, [registry, focusPreference, focusSeq]);
  useEffect(() => {
    let cancelled = false;
    async function loadPreferences() {
      try {
        const tenantId = await workspaceTenantId();
        const [read, record] = await Promise.all([
          productClient().preferenceRegistry(tenantId),
          productClient().personalSettings(tenantId),
        ]);
        if (cancelled) return;
        setRegistry(read.preferences);
        const loadedField = record.fields.preferences ?? {
          value: null,
          version: 0,
        };
        setField(loadedField);
        const approvalsVal = loadedField.value?.["experimental_approvals"];
        if (approvalsVal === "yes" || approvalsVal === "no") {
          writeWorkspaceApprovalsEnabled(approvalsVal === "yes" ? "on" : "off");
        }
      } catch (cause) {
        if (!cancelled) {
          setRegistry((prev) => (prev === null ? [] : prev));
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      }
    }
    void loadPreferences();
    return () => {
      cancelled = true;
    };
  }, []);
  const choose = async (id: string, choice: string) => {
    const isExperimental = syncExperimentalPreference(id, choice);
    const inHubRegistry =
      registry !== null && registry.some((entry) => entry.id === id);
    if (!field || (isExperimental && !inHubRegistry)) {
      if (isExperimental) {
        setSave({ id, state: "saved" });
      }
      return;
    }
    setSave({ id, state: "saving" });
    try {
      const receipt = await productClient().savePersonalSettings(
        await workspaceTenantId(),
        {
          command: "save_settings",
          idempotencyKey: crypto.randomUUID(),
          fields: {
            preferences: {
              value: { ...field.value, [id]: choice },
              baseVersion: field.version,
            },
          },
        },
      );
      setField(receipt.record.fields.preferences ?? field);
      void queryClient.invalidateQueries({ queryKey: keys.preferences });
      const conflicted = receipt.conflicts.length > 0;
      setSave({ id, state: conflicted ? "failed" : "saved" });
      if (conflicted) toast.error(wording.message.stepFailed);
    } catch (cause) {
      setSave({ id, state: "failed" });
      toast.error(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const copy = wording.settings.preferences;
  const preferences = mergeExperimentalPreferences(registry);
  return (
    <Section title={copy.section} description={copy.lead}>
      <SettingsSectionBody>
        {preferences.map((preference) => {
          const id = `preference-${preference.id}`;
          const isExperimental = preference.id === "experimental_approvals";
          const choice = resolvePreferenceChoice(
            preference,
            field?.value,
            approvalsEnabled,
          );
          const state = save?.id === preference.id ? save.state : null;
          const disabled = (!field && !isExperimental) || state === "saving";
          return (
            <SettingsRow
              key={preference.id}
              id={`preference-row-${preference.id}`}
              highlighted={highlightedId === preference.id}
              label={preference.label}
              htmlFor={id}
              {...(preference.hint ? { hint: preference.hint } : {})}
            >
              <SettingsRowValue>
                {state ? (
                  <QuietState tone={SAVE_TONES[state]}>
                    {copy[state]}
                  </QuietState>
                ) : null}
                {isOnOff(preference) ? (
                  <Switch
                    id={id}
                    checked={choice === "yes"}
                    onCheckedChange={(on) =>
                      void choose(preference.id, on ? "yes" : "no")
                    }
                    disabled={disabled}
                  />
                ) : (
                  <QuietSelect
                    id={id}
                    value={choice}
                    onChange={(event) =>
                      void choose(preference.id, event.target.value)
                    }
                    disabled={disabled}
                  >
                    {preference.options.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </QuietSelect>
                )}
              </SettingsRowValue>
            </SettingsRow>
          );
        })}
        {error ? <Banner tone="error" title={error} /> : null}
      </SettingsSectionBody>
    </Section>
  );
}

/** Who is signed in, and a way out. The hub has no rename or
 * password-change endpoints, so there are no controls for them. */
function Account({
  user,
  onSignOut,
}: {
  user: HubUser;
  onSignOut?: () => Promise<void>;
}) {
  const [signingOut, setSigningOut] = useState(false);
  const signOut = async (leave: () => Promise<void>) => {
    setSigningOut(true);
    try {
      await leave();
    } finally {
      setSigningOut(false);
    }
  };
  const copy = wording.settings.account;
  return (
    <Section title={copy.section} description={copy.lead}>
      <SettingsSectionBody>
        <SettingsRow label={copy.name}>
          <SettingsRowValue>{user.name}</SettingsRowValue>
        </SettingsRow>
        <SettingsRow label={copy.email}>
          <SettingsRowValue>{user.email}</SettingsRowValue>
        </SettingsRow>
        {onSignOut ? (
          <SettingsRow>
            <Button
              variant="outline"
              loading={signingOut}
              onClick={() => void signOut(onSignOut)}
            >
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
