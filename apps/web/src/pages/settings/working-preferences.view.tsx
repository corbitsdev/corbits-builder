/**
 * The working preferences as they look: a group under each heading, a row per preference with what
 * its choice means, chosen with segments or, where the choices have an order, a scale.
 */
import { wording } from "../../config.ts";
import type { PreferenceGroup } from "@corbits-builder/schemas/preferences";
import { useEffect, useState, type ReactNode } from "react";
import { Banner, QuietState } from "../../components.jsx";
import { SettingsRow } from "./settings-row.tsx";
import { SettingsGroup } from "./settings-section.tsx";
import { ChoiceScale, ChoiceSegments } from "./preference-choice.tsx";

export type PreferenceRow = {
  id: string;
  label: string;
  group: PreferenceGroup;
  /** What the preference decides. */
  hint: string | undefined;
  options: readonly { readonly id: string; readonly label: string }[];
  /** The id of the option chosen. */
  choice: string;
  /** Set when the options have an order: they are a scale between these two words. */
  ends: { readonly start: string; readonly end: string } | null;
  /** How saving its last change went; null when it has not been changed. */
  save: "saving" | "saved" | "failed" | null;
  /** It cannot be changed yet: its choice has not been read. */
  disabled: boolean;
};

export type WorkingPreferencesViewProps = {
  preferences: readonly PreferenceRow[];
  onChoose: (id: string, choice: string) => void;
  /** Why the preferences could not be read. */
  fault: string | null;
  /** The preference the person was sent to: scrolled to, focused and marked for a moment. */
  focusPreference: string | null;
  /** Goes up each time they are sent, so being sent to the same preference jumps again. */
  focusSeq: number;
  /** The saved reviewers, closing the stakeholder approvals group. */
  reviewers: ReactNode;
};

const SAVE_TONES = {
  saving: "loading",
  saved: "success",
  failed: "error",
} as const;

type GroupHeading = { title: string; lead: string; tag?: string };

const GROUPS = Object.keys(
  wording.settings.preferences.groups,
) as PreferenceGroup[];

export function WorkingPreferencesView({
  preferences,
  onChoose,
  fault,
  focusPreference,
  focusSeq,
  reviewers,
}: WorkingPreferencesViewProps) {
  const [highlightedId, setHighlightedId] = useState<string | null>(
    focusPreference,
  );
  // More rows arrive once the hub's preferences are read and move the one sent to, so it jumps again.
  const rows = preferences.length;
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
  }, [rows, focusPreference, focusSeq]);

  const copy = wording.settings.preferences;
  return (
    <>
      {fault ? <Banner tone="error" title={fault} /> : null}
      {GROUPS.map((group) => {
        const members = preferences.filter(
          (preference) => preference.group === group,
        );
        // Until the hub answers, a group with none of its preferences stays out of the way.
        if (members.length === 0) return null;
        const heading: GroupHeading = copy.groups[group];
        return (
          <SettingsGroup
            key={group}
            title={heading.title}
            tag={heading.tag}
            lead={heading.lead}
          >
            {members.map((preference) => {
              const control = {
                id: `preference-${preference.id}`,
                label: preference.label,
                options: preference.options,
                choice: preference.choice,
                onChoose: (option: string) => onChoose(preference.id, option),
                disabled: preference.disabled,
              };
              return (
                <SettingsRow
                  key={preference.id}
                  id={`preference-row-${preference.id}`}
                  layout="columns"
                  highlighted={highlightedId === preference.id}
                  label={preference.label}
                  aside={<SaveNote save={preference.save} />}
                  hint={preference.hint}
                  htmlFor={control.id}
                >
                  {preference.ends ? (
                    <ChoiceScale {...control} ends={preference.ends} />
                  ) : (
                    <ChoiceSegments {...control} />
                  )}
                </SettingsRow>
              );
            })}
            {group === "approvals" ? reviewers : null}
          </SettingsGroup>
        );
      })}
    </>
  );
}

/** How a preference's last change saved. */
function SaveNote({ save }: { save: PreferenceRow["save"] }) {
  return save ? (
    <QuietState tone={SAVE_TONES[save]}>
      {wording.settings.preferences[save]}
    </QuietState>
  ) : null;
}
