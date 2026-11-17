/**
 * The look panel over a designer's mockup: a few values the person changes and sees applied live,
 * with a save where there is a design to save them into.
 */
import { Button, Select } from "@corbits/react-ui";
import { useEffect, useRef, type ReactNode } from "react";
import { wording } from "../../config.ts";
import type { LookTweaks } from "./mockup-look.ts";
import styles from "./mockup-tweaks.module.css";

/** What the mockup's frame gives the panel it opens. */
export type TweakPanelProps = {
  /** The mockup's own look, shown wherever the person has changed nothing. */
  look: LookTweaks;
  /** The person's changes so far, applied live. */
  tweaks: LookTweaks;
  onChange: (tweaks: LookTweaks) => void;
  onClose: () => void;
};

export type TweakPanelViewProps = TweakPanelProps & {
  /** Saves the tweaks into the design. */
  onSave: () => void;
  /** A save is under way, so Save waits. */
  saving: boolean;
};

const PRIMARY_SWATCHES = [
  "#e98428",
  "#2563eb",
  "#16a34a",
  "#7c3aed",
  "#db2777",
  "#0f172a",
];
const BACKGROUND_SWATCHES = [
  "#ffffff",
  "#faf7f2",
  "#f5f7fa",
  "#f4f4f0",
  "#f7f2fa",
];
// The mockup frame has no network, so only stacks the viewer's system already has render.
const FONT_STACKS: Record<string, string> = {
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: 'ui-serif, Georgia, "Times New Roman", serif',
  rounded: 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
};
const RADIUS_MAX_REM = 1.5;
const RADIUS_STEP_REM = 0.125;

/** A label and its value side by side. */
function TweakRow({
  as: Tag = "label",
  children,
}: {
  as?: "label" | "span" | "li";
  children: ReactNode;
}) {
  return (
    <Tag className={styles.row} data-slot="tweak-row">
      {children}
    </Tag>
  );
}

/** A row of buttons pushed to the end. */
function TweakActions({ children }: { children: ReactNode }) {
  return (
    <div className={styles.actions} data-slot="tweak-actions">
      {children}
    </div>
  );
}

function Swatches({
  label,
  colors,
  value,
  onPick,
}: {
  label: string;
  colors: readonly string[];
  value: string | undefined;
  onPick: (color: string) => void;
}) {
  return (
    <div className={styles.swatches} role="group" aria-label={label}>
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          className={styles.swatch}
          style={{ background: color }}
          aria-label={color}
          aria-pressed={value?.toLowerCase() === color}
          onClick={() => onPick(color)}
        />
      ))}
    </div>
  );
}

export function TweakPanelView({
  look,
  tweaks,
  onChange,
  onClose,
  onSave,
  saving,
}: TweakPanelViewProps) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.querySelector("input")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const primary = tweaks.primary ?? look.primary ?? PRIMARY_SWATCHES[0]!;
  const background = tweaks.background ?? look.background;
  const radius = tweaks.radius ?? look.radius ?? 0.5;
  const fontKey =
    Object.entries(FONT_STACKS).find(
      ([, stack]) => stack === tweaks.font,
    )?.[0] ?? "current";
  const changed = Object.keys(tweaks).length > 0;
  return (
    <div
      ref={panel}
      className={styles.panel}
      data-slot="tweak-panel"
      role="dialog"
      aria-label={wording.tweak.panel}
    >
      <TweakRow>
        <span>{wording.tweak.primary}</span>
        <input
          type="color"
          className={styles.color}
          value={primary}
          onChange={(event) =>
            onChange({ ...tweaks, primary: event.target.value })
          }
        />
      </TweakRow>
      <Swatches
        label={wording.tweak.primary}
        colors={PRIMARY_SWATCHES}
        value={tweaks.primary ?? look.primary}
        onPick={(color) => onChange({ ...tweaks, primary: color })}
      />
      <TweakRow as="span">{wording.tweak.background}</TweakRow>
      <Swatches
        label={wording.tweak.background}
        colors={BACKGROUND_SWATCHES}
        value={background}
        onPick={(color) => onChange({ ...tweaks, background: color })}
      />
      <TweakRow>
        <span>{wording.tweak.radius}</span>
        <output>{`${String(radius)}rem`}</output>
      </TweakRow>
      <input
        type="range"
        className={styles.range}
        aria-label={wording.tweak.radius}
        min={0}
        max={RADIUS_MAX_REM}
        step={RADIUS_STEP_REM}
        value={radius}
        onChange={(event) =>
          onChange({ ...tweaks, radius: Number(event.target.value) })
        }
      />
      <TweakRow>
        <span>{wording.tweak.font}</span>
        <Select
          value={fontKey}
          onChange={(event) => {
            const next: LookTweaks = { ...tweaks };
            delete next.font;
            const font = FONT_STACKS[event.target.value];
            onChange(font === undefined ? next : { ...next, font });
          }}
        >
          {["current", ...Object.keys(FONT_STACKS)].map((key) => (
            <option key={key} value={key}>
              {wording.tweak.fonts[key] ?? key}
            </option>
          ))}
        </Select>
      </TweakRow>
      <TweakActions>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!changed}
          onClick={() => onChange({})}
        >
          {wording.tweak.reset}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!changed || saving}
          onClick={onSave}
        >
          {wording.tweak.save}
        </Button>
      </TweakActions>
    </div>
  );
}
