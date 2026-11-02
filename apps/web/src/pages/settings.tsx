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
  Badge,
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
  addCustomReviewerPersona,
  addWorkspaceReviewer,
  allReviewerPersonas,
  removeWorkspaceReviewer,
  useCustomReviewerPersonas,
  useWorkspaceApprovalsEnabled,
  useWorkspaceReviewers,
  writeWorkspaceApprovalsEnabled,
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

type SettingsTab = keyof typeof wording.settings.tab;

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
  const requested = new URLSearchParams(window.location.search).get("tab");
  return isSettingsTab(requested) ? requested : "providers";
}

/** Replaces rather than pushes, so switching tabs never adds a Back step. */
function writeSearch(edit: (search: URLSearchParams) => void): void {
  const url = new URL(window.location.href);
  edit(url.searchParams);
  window.history.replaceState(window.history.state, "", url);
}

/** Keeps the open tab in the address bar while Settings is shown, and takes
 * back on leaving only the parameters it added. */
function useTabInUrl(): [SettingsTab, (tab: SettingsTab) => void] {
  const [tab, setTab] = useState(tabInUrl);
  useEffect(() => {
    const addedView =
      new URLSearchParams(window.location.search).get("view") !== "settings";
    return () =>
      writeSearch((search) => {
        search.delete("tab");
        if (addedView && search.get("view") === "settings")
          search.delete("view");
      });
  }, []);
  useEffect(() => {
    writeSearch((search) => {
      search.set("view", "settings");
      search.set("tab", tab);
    });
  }, [tab]);
  return [tab, setTab];
}

export function Settings({
  onChanged,
  user = null,
  onSignOut,
}: {
  onChanged: () => void;
  /** Who is signed in; the Account section names them. */
  user?: HubUser | null;
  onUserChanged?: (user: HubUser) => void;
  onSignOut?: () => Promise<void>;
}) {
  const [tab, setTab] = useTabInUrl();
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
        {user ? <WorkingPreferences /> : null}
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
        active={tab}
        onChange={setTab}
        label={wording.settings.sections}
        className="settings-tabs"
      >
        {renderTabContent}
      </Tabs>
    </div>
  );
}

function Row({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  /** The control the label names, when the row holds one. */
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="row">
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
    addWorkspaceReviewer({
      name: name.trim(),
      persona: effectivePersona,
      ...(trimmedEmail.length > 0 ? { email: trimmedEmail } : {}),
    });
    setName("");
    setEmail("");
    if (customPersonaOpen) {
      setPersona(effectivePersona);
      setCustomPersonaOpen(false);
      setCustomPersonaDraft("");
    }
  };

  return (
    <Section title={copy.section} description={copy.lead}>
      <div className="section-body">
        <Row label={copy.requireLabel} hint={copy.requireHint}>
          <Switch
            label={copy.requireLabel}
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
          reviewers.map((reviewer) => (
            <Row
              key={reviewer.id}
              label={reviewer.name}
              {...(reviewer.email === undefined
                ? {}
                : { hint: reviewer.email })}
            >
              <span className="v">
                <Badge tone="neutral">{reviewer.persona}</Badge>
                <Button
                  variant="ghost"
                  onClick={() => removeWorkspaceReviewer(reviewer.id)}
                >
                  {copy.removeReviewer}
                </Button>
              </span>
            </Row>
          ))
        )}
        <div className="row">
          <div className="invite-form">
            <input
              className="field"
              aria-label={copy.reviewerName}
              placeholder={copy.reviewerName}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <QuietSelect
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
            </QuietSelect>
            {customPersonaOpen ? (
              <input
                className="field"
                aria-label={roundCopy.customPersonaLabel}
                placeholder={roundCopy.customPersonaPlaceholder}
                value={customPersonaDraft}
                onChange={(event) => setCustomPersonaDraft(event.target.value)}
              />
            ) : null}
            <input
              className="field"
              aria-label={copy.reviewerEmail}
              placeholder={copy.reviewerEmail}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <Button
              variant="outline"
              disabled={!canAdd}
              onClick={handleAddReviewer}
            >
              {copy.addReviewer}
            </Button>
          </div>
        </div>
      </div>
    </Section>
  );
}

/** The theme, and the document tips choice kept in this browser. */
function Appearance() {
  const { mode, setMode } = useTheme();
  const tips = useDocumentTips();
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

/** A preference whose only choices are Off and On, shown as a switch. */
function isOnOff(
  preference: PreferenceRegistry["preferences"][number],
): boolean {
  return preference.options.map((option) => option.id).join() === "no,yes";
}

/** The person's working preferences, from the hub's registry and kept by the hub, which
 * delivers them to every role they apply to. Each change saves as it is made. */
function WorkingPreferences() {
  const queryClient = useQueryClient();
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
  useEffect(() => {
    void workspaceTenantId()
      .then((tenantId) =>
        Promise.all([
          productClient().preferenceRegistry(tenantId),
          productClient().personalSettings(tenantId),
        ]),
      )
      .then(([read, record]) => {
        setRegistry(read.preferences);
        setField(record.fields.preferences ?? { value: null, version: 0 });
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      );
  }, []);
  const choose = async (id: string, choice: string) => {
    if (!field) return;
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
  return (
    <Section title={copy.section} description={copy.lead}>
      <div className="section-body">
        {registry?.map((preference) => {
          const id = `preference-${preference.id}`;
          const choice = field?.value?.[preference.id] ?? preference.default;
          const state = save?.id === preference.id ? save.state : null;
          const disabled = !field || state === "saving";
          return (
            <Row
              key={preference.id}
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
