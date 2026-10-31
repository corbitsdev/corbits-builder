/**
 * Live look tweaks over a designer's mockup: the frame is cross-origin, so the values go in as a
 * stylesheet message the page applies over its own tokens. Nothing changes in the design until
 * the person saves them: the hub writes them into the design's styles.css and tells the
 * coordinator and the designer. A save is never an approval.
 */
import { Button, Select } from "@corbits/react-ui";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { wording } from "../../config.ts";
import { saveDesignTweaks } from "../../api/artifacts.ts";
import type { DesignFiles } from "./design-preview.tsx";
import { humanFault } from "./human-fault.ts";

export type LookTweaks = {
  primary?: string;
  background?: string;
  /** Corner radius in rem. */
  radius?: number;
  font?: string;
};

/** The design a saved look goes into: the project's, or one design concept's. */
export const DesignTarget = createContext<{
  projectId: string;
  concept?: string;
} | null>(null);

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
const HEX = /^#[0-9a-f]{6}$/i;

const token = (css: string, name: string) =>
  new RegExp(`--${name}\\s*:\\s*([^;}]+)`).exec(css)?.[1]?.trim();

function remOf(value: string | undefined): number | undefined {
  const match = /^([\d.]+)(rem|px)$/.exec(value ?? "");
  if (match === null) return undefined;
  const size = Number(match[1]);
  return match[2] === "px" ? size / 16 : size;
}

/** The mockup's own light-scheme tokens, read from the first stylesheet that declares them. */
export function mockupLook(files: DesignFiles): LookTweaks {
  const css = Object.entries(files)
    .filter(([path]) => path.startsWith("designs/") && path.endsWith(".css"))
    .map(([, text]) => text)
    .join("\n");
  const primary = token(css, "primary");
  const background = token(css, "background");
  const radius = remOf(token(css, "radius"));
  const font = token(css, "font-sans");
  return {
    ...(primary !== undefined && HEX.test(primary) ? { primary } : {}),
    ...(background !== undefined && HEX.test(background) ? { background } : {}),
    ...(radius === undefined ? {} : { radius }),
    ...(font === undefined ? {} : { font }),
  };
}

function readableOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map(
    (at) => parseInt(hex.slice(at, at + 2), 16) / 255,
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? "#1a1718" : "#ffffff";
}

const cssValue = (value: string) => value.replace(/[<>{};]/g, "");

/** The custom properties a look sets, keyed without their leading dashes. */
function lookTokens(tweaks: LookTweaks): Record<string, string> {
  const tokens: Record<string, string> = {};
  if (tweaks.primary !== undefined) {
    const primary = cssValue(tweaks.primary);
    tokens["primary"] = primary;
    tokens["primary-foreground"] = readableOn(primary);
    tokens["primary-active"] = `color-mix(in srgb,${primary} 85%,black)`;
    tokens["ring"] = `color-mix(in srgb,${primary} 70%,black)`;
  }
  if (tweaks.background !== undefined)
    tokens["background"] = cssValue(tweaks.background);
  if (tweaks.radius !== undefined)
    tokens["radius"] = `${String(tweaks.radius)}rem`;
  if (tweaks.font !== undefined) tokens["font-sans"] = cssValue(tweaks.font);
  return tokens;
}

/**
 * Doubled selectors outrank the stylesheet's own :root and .dark blocks wherever this lands in
 * the page; the background is a light-scheme tone, so dark keeps its own.
 */
export function tweakCss(tweaks: LookTweaks): string {
  const { background, ...shared } = lookTokens(tweaks);
  const declarations = Object.entries(shared).map(
    ([name, value]) => `--${name}:${value}`,
  );
  const rules =
    declarations.length === 0
      ? []
      : [`:root:root,.dark.dark{${declarations.join(";")}}`];
  if (background !== undefined)
    rules.push(`:root:root:not(.dark){--background:${background}}`);
  return rules.join("");
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
    <div className="tweak-swatches" role="group" aria-label={label}>
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          className="tweak-swatch"
          style={{ background: color }}
          aria-label={color}
          aria-pressed={value?.toLowerCase() === color}
          onClick={() => onPick(color)}
        />
      ))}
    </div>
  );
}

export function TweakPanel({
  look,
  tweaks,
  onChange,
  onClose,
}: {
  look: LookTweaks;
  tweaks: LookTweaks;
  onChange: (tweaks: LookTweaks) => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const target = useContext(DesignTarget);
  const [saving, setSaving] = useState(false);
  // The live tweaks stay applied after a save: they now match the design's own styles.css.
  const save = async () => {
    if (target === null) return;
    setSaving(true);
    try {
      const receipt = await saveDesignTweaks(target.projectId, {
        tokens: lookTokens(tweaks),
        ...(target.concept === undefined ? {} : { concept: target.concept }),
      });
      toast.success(wording.tweak.saved(receipt.updated));
      onClose();
    } catch (cause) {
      toast.error(humanFault(cause, wording.tweak.saveFailed));
    } finally {
      setSaving(false);
    }
  };
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
      className="tweak-panel"
      role="dialog"
      aria-label={wording.tweak.panel}
    >
      <label className="tweak-row">
        <span>{wording.tweak.primary}</span>
        <input
          type="color"
          className="tweak-color"
          value={primary}
          onChange={(event) =>
            onChange({ ...tweaks, primary: event.target.value })
          }
        />
      </label>
      <Swatches
        label={wording.tweak.primary}
        colors={PRIMARY_SWATCHES}
        value={tweaks.primary ?? look.primary}
        onPick={(color) => onChange({ ...tweaks, primary: color })}
      />
      <span className="tweak-row">{wording.tweak.background}</span>
      <Swatches
        label={wording.tweak.background}
        colors={BACKGROUND_SWATCHES}
        value={background}
        onPick={(color) => onChange({ ...tweaks, background: color })}
      />
      <label className="tweak-row">
        <span>{wording.tweak.radius}</span>
        <output>{`${String(radius)}rem`}</output>
      </label>
      <input
        type="range"
        className="tweak-range"
        aria-label={wording.tweak.radius}
        min={0}
        max={RADIUS_MAX_REM}
        step={RADIUS_STEP_REM}
        value={radius}
        onChange={(event) =>
          onChange({ ...tweaks, radius: Number(event.target.value) })
        }
      />
      <label className="tweak-row">
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
      </label>
      <div className="tweak-actions">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!changed}
          onClick={() => onChange({})}
        >
          {wording.tweak.reset}
        </Button>
        {target === null ? null : (
          <Button
            type="button"
            size="sm"
            disabled={!changed || saving}
            onClick={() => void save()}
          >
            {wording.tweak.save}
          </Button>
        )}
      </div>
    </div>
  );
}
