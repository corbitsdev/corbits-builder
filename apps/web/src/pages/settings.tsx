/**
 * Settings: Providers (model connections), Profiles (which model and effort
 * each role runs on), Preferences (how Builder works with the person, the
 * look, and their account at the bottom),
 * Collaborators (roles and invitations), and About (with its open source
 * notices). Only what has a real backing shows.
 *
 * They are grouped into tabs; the open tab is `?tab=` beside `?view=settings`,
 * so each one can be linked. Each section is the library's `Section`; its
 * rows keep the mockup's row / k / v language.
 */
import { wording } from "../config.ts";
import {
  Button as UiButton,
  Section,
  Switch,
  Tabs,
  useTheme,
  type ThemeMode,
} from "@corbits/react-ui";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { keys } from "../queries/keys.ts";
import { ProvidersSection } from "./providers.jsx";
import { Profiles } from "./profiles.jsx";
import {
  useDocumentTips,
  writeDocumentTips,
} from "../document-tips-setting.ts";
import {
  useQuestionsLayout,
  writeQuestionsLayout,
} from "../questions-layout-setting.ts";
import {
  addCustomReviewerPersona,
  addWorkspaceReviewer,
  allReviewerPersonas,
  removeWorkspaceReviewer,
  useCustomReviewerPersonas,
  useWorkspaceApprovalsEnabled,
  useWorkspaceReviewers,
  writeWorkspaceApprovalsEnabled,
  type OnOff,
} from "../workspace-approvals-setting.ts";
import { Collaborators } from "./collaborators.jsx";
import { Banner, Button, QuietSelect, QuietState } from "../components.jsx";
import { productClient } from "../api/transport.ts";
import { workspaceTenantId, type HubUser } from "../api/auth.ts";
import { openSourceNotices } from "../open-source.ts";
import { Credit } from "../flourish.tsx";
import type {
  PreferenceRegistry,
  Preferences,
} from "@corbits-builder/schemas/preferences";
import "./settings-layout.css";

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
    <div className="settings-page">
      <h1>{wording.settings.title}</h1>
      <Tabs
        tabs={SETTINGS_TABS}
        active={activeTab}
        onChange={setActiveTab}
        label={wording.settings.sections}
        className="settings-tabs"
      >
        {renderTabContent}
      </Tabs>
    </div>
  );
}

function Row({
  id,
  highlighted = false,
  label,
  hint,
  htmlFor,
  children,
}: {
  id?: string;
  highlighted?: boolean;
  label: string;
  hint?: string;
  /** The control the label names, when the row holds one. */
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      className={highlighted ? "row is-highlighted" : "row"}
      data-highlighted={highlighted ? "true" : undefined}
    >
      <div className="k">
        {htmlFor ? (
          <label htmlFor={htmlFor}>
            <b>{label}</b>
          </label>
        ) : (
          <b>{label}</b>
        )}
        {hint ? <span>{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

const OTHER_PERSONA_OPTION = "__other__";

/** Workspace-level approval toggle and saved workspace reviewers. */
export function WorkspaceApprovals() {
  const approvalsEnabled = useWorkspaceApprovalsEnabled();
  const reviewers = useWorkspaceReviewers();
  const customPersonas = useCustomReviewerPersonas();
  const personaOptions = allReviewerPersonas(customPersonas, reviewers);
  const [name, setName] = useState("");
  const [persona, setPersona] = useState<string>(
    wording.approvalRound.reviewerPersonas[0],
  );
  const [customPersonaOpen, setCustomPersonaOpen] = useState(false);
  const [customPersonaDraft, setCustomPersonaDraft] = useState("");
  const [email, setEmail] = useState("");
  const [goal, setGoal] = useState("");
  const copy = wording.settings.approvals;
  const roundCopy = wording.approvalRound;

  const effectivePersona = customPersonaOpen
    ? customPersonaDraft.trim()
    : persona.trim();
  const canAdd = name.trim().length > 0 && effectivePersona.length > 0;

  const handleSelectPersona = (value: string) => {
    if (value === OTHER_PERSONA_OPTION) {
      setCustomPersonaOpen(true);
      setCustomPersonaDraft("");
      return;
    }
    setCustomPersonaOpen(false);
    setPersona(value);
  };

  const handleAddReviewer = () => {
    if (!canAdd) return;
    if (customPersonaOpen) {
      addCustomReviewerPersona(effectivePersona);
    }
    const trimmedEmail = email.trim();
    const trimmedGoal = goal.trim();
    addWorkspaceReviewer({
      name: name.trim(),
      persona: effectivePersona,
      ...(trimmedEmail.length > 0 ? { email: trimmedEmail } : {}),
      ...(trimmedGoal.length > 0 ? { goal: trimmedGoal } : {}),
    });
    setName("");
    setEmail("");
    setGoal("");
    if (customPersonaOpen) {
      setPersona(effectivePersona);
      setCustomPersonaOpen(false);
      setCustomPersonaDraft("");
    }
  };

  return (
    <Section title={copy.section} description={copy.lead}>
      <div className="section-body">
        <Row
          label={copy.requireLabel}
          hint={copy.requireHint}
          htmlFor="workspace-approvals-enabled"
        >
          <Switch
            id="workspace-approvals-enabled"
            checked={approvalsEnabled === "on"}
            onCheckedChange={(on) =>
              writeWorkspaceApprovalsEnabled(on ? "on" : "off")
            }
          />
        </Row>
        <h3 className="about-subhead">{copy.reviewersSubhead}</h3>
        <p className="about-lead">{copy.reviewersLead}</p>
        {reviewers.length === 0 ? (
          <p className="inline-note">{copy.emptyReviewers}</p>
        ) : (
          reviewers.map((reviewer) => {
            const hintParts = [reviewer.goal, reviewer.email].filter(
              (part): part is string => part !== undefined && part !== "",
            );
            return (
              <Row
                key={reviewer.id}
                label={reviewer.name}
                {...(hintParts.length === 0
                  ? {}
                  : { hint: hintParts.join(" · ") })}
              >
                <span className="v">
                  <span className="approval-status-text">
                    {reviewer.persona}
                  </span>
                  <UiButton
                    size="sm"
                    variant="ghost"
                    className="approval-lean-btn"
                    onClick={() => removeWorkspaceReviewer(reviewer.id)}
                  >
                    {copy.removeReviewer}
                  </UiButton>
                </span>
              </Row>
            );
          })
        )}
        <div className="approval-inline-fields settings-reviewer-form">
          <div className="approval-field-row">
            <span className="approval-field-label">
              {roundCopy.fieldLabels.name}
            </span>
            <input
              className="approval-lean-input"
              aria-label={copy.reviewerName}
              placeholder={copy.reviewerName}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="approval-field-row">
            <span className="approval-field-label">
              {roundCopy.fieldLabels.role}
            </span>
            <select
              className="approval-lean-select"
              aria-label={copy.reviewerPersona}
              value={customPersonaOpen ? OTHER_PERSONA_OPTION : persona}
              onChange={(event) => handleSelectPersona(event.target.value)}
            >
              {personaOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
              <option value={OTHER_PERSONA_OPTION}>
                {roundCopy.otherPersona}
              </option>
            </select>
          </div>
          {customPersonaOpen ? (
            <div className="approval-field-row">
              <span className="approval-field-label">
                {roundCopy.customPersonaLabel}
              </span>
              <input
                className="approval-lean-input"
                aria-label={roundCopy.customPersonaLabel}
                placeholder={roundCopy.customPersonaPlaceholder}
                value={customPersonaDraft}
                onChange={(event) => setCustomPersonaDraft(event.target.value)}
              />
            </div>
          ) : null}
          <div className="approval-field-row">
            <span className="approval-field-label">
              {roundCopy.fieldLabels.focus}
            </span>
            <input
              className="approval-lean-input"
              aria-label={copy.reviewerGoal}
              placeholder={copy.reviewerGoal}
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
            />
          </div>
          <div className="approval-field-row">
            <span className="approval-field-label">
              {wording.settings.account.email}
            </span>
            <input
              className="approval-lean-input"
              aria-label={copy.reviewerEmail}
              placeholder={copy.reviewerEmail}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="settings-reviewer-form-actions">
            <UiButton
              size="sm"
              variant="outline"
              className="approval-field-save-btn"
              disabled={!canAdd}
              onClick={handleAddReviewer}
            >
              {copy.addReviewer}
            </UiButton>
          </div>
        </div>
      </div>
    </Section>
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
      <div className="section-body">
        <Row label={copy.theme} htmlFor="settings-theme">
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
        </Row>
        <Row label={wording.tips.setting} hint={wording.tips.settingHint}>
          <Switch
            label={wording.tips.setting}
            checked={tips === "on"}
            onCheckedChange={(on) => writeDocumentTips(on ? "on" : "off")}
          />
        </Row>
        <Row
          label={wording.questions.layoutSetting}
          hint={wording.questions.layoutHint}
        >
          <Switch
            label={wording.questions.layoutSetting}
            checked={questionsLayout === "steps"}
            onCheckedChange={(on) => writeQuestionsLayout(on ? "steps" : "all")}
          />
        </Row>
      </div>
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
        (controlEl?.closest(".row") as HTMLElement | null);
      if (rowEl) {
        rowEl.setAttribute("data-highlighted", "true");
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
        (controlEl?.closest(".row") as HTMLElement | null);
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
      <div className="section-body">
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
            <Row
              key={preference.id}
              id={`preference-row-${preference.id}`}
              highlighted={highlightedId === preference.id}
              label={preference.label}
              htmlFor={id}
              {...(preference.hint ? { hint: preference.hint } : {})}
            >
              <span className="v">
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
              </span>
            </Row>
          );
        })}
        {error ? <Banner tone="error" title={error} /> : null}
      </div>
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
  const copy = wording.settings.account;
  return (
    <Section title={copy.section} description={copy.lead}>
      <div className="section-body">
        <Row label={copy.name}>
          <span className="v">{user.name}</span>
        </Row>
        <Row label={copy.email}>
          <span className="v">{user.email}</span>
        </Row>
        {onSignOut ? (
          <div className="row">
            <Button
              variant="outline"
              loading={signingOut}
              onClick={() => {
                setSigningOut(true);
                void onSignOut().finally(() => setSigningOut(false));
              }}
            >
              {wording.action.signOut}
            </Button>
          </div>
        ) : null}
      </div>
    </Section>
  );
}

function About() {
  const copy = wording.settings.about;
  return (
    <Section title={copy.section} description={copy.lead}>
      <div className="section-body">
        <h3 className="about-subhead">{copy.openSource}</h3>
        <p className="about-lead">{copy.openSourceLead}</p>
        {openSourceNotices.map((notice) => (
          <Row key={notice.name} label={notice.name} hint={notice.use}>
            <span className="v">
              {copy.kind[notice.kind]}
              <a href={notice.link} target="_blank" rel="noreferrer">
                {notice.license ?? copy.unconfirmed}
              </a>
            </span>
          </Row>
        ))}
      </div>
      <Credit />
    </Section>
  );
}
