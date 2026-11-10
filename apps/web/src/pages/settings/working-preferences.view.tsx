/**
 * The working preferences section as it looks: one row per preference, a switch or a list of
 * choices, with how its last change went beside it.
 */
import { wording } from "../../config.ts";
import { Section, Switch } from "@corbits/react-ui";
import { useEffect, useState } from "react";
import { Banner, QuietSelect, QuietState } from "../../components.jsx";
import { SettingsRow, SettingsRowValue } from "./settings-row.tsx";
import { SettingsSectionBody } from "./settings-section.tsx";

export type PreferenceRow = {
  id: string;
  label: string;
  hint: string | undefined;
  /** How saving its last change went; null when it has not been changed. */
  save: "saving" | "saved" | "failed" | null;
  /** It cannot be changed yet: its choice has not been read, or a change is being saved. */
  disabled: boolean;
} & (
  | { kind: "switch"; on: boolean }
  | {
      kind: "list";
      options: readonly { readonly id: string; readonly label: string }[];
      /** The id of the option chosen. */
      choice: string;
    }
);

export type WorkingPreferencesViewProps = {
  preferences: readonly PreferenceRow[];
  onSwitch: (id: string, on: boolean) => void;
  onChoose: (id: string, choice: string) => void;
  /** Why the preferences could not be read. */
  fault: string | null;
  /** The preference the person was sent to: scrolled to, focused and marked for a moment. */
  focusPreference: string | null;
  /** Goes up each time they are sent, so being sent to the same preference jumps again. */
  focusSeq: number;
};

const SAVE_TONES = {
  saving: "loading",
  saved: "success",
  failed: "error",
} as const;

export function WorkingPreferencesView({
  preferences,
  onSwitch,
  onChoose,
  fault,
  focusPreference,
  focusSeq,
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
    <Section title={copy.section} description={copy.lead}>
      <SettingsSectionBody>
        {preferences.map((preference) => {
          const id = `preference-${preference.id}`;
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
                {preference.save ? (
                  <QuietState tone={SAVE_TONES[preference.save]}>
                    {copy[preference.save]}
                  </QuietState>
                ) : null}
                {preference.kind === "switch" ? (
                  <Switch
                    id={id}
                    checked={preference.on}
                    onCheckedChange={(on) => onSwitch(preference.id, on)}
                    disabled={preference.disabled}
                  />
                ) : (
                  <QuietSelect
                    id={id}
                    value={preference.choice}
                    onChange={(event) =>
                      onChoose(preference.id, event.target.value)
                    }
                    disabled={preference.disabled}
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
        {fault ? <Banner tone="error" title={fault} /> : null}
      </SettingsSectionBody>
    </Section>
  );
}
