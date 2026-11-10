/**
 * Prebuilt looks a person browses once the project reaches design: a gallery of each theme's
 * example mockup, and one theme opened to click through and tweak live.
 */
import { ArrowLeft, MessageSquarePlus } from "lucide-react";
import { useState } from "react";
import { wording } from "../../config.ts";
import { InlineNote } from "../../components.tsx";
import type { DesignFiles } from "./design-bundle.ts";
import { MockupFrameView } from "./design-preview.view.tsx";
import type { PreviewDevice } from "./device-preview.tsx";
import { GuiFrame } from "./gui-frame.tsx";
import type { LookTweaks } from "./mockup-look.ts";
import { TweakPanelView } from "./mockup-tweaks.view.tsx";
import styles from "./design-themes.module.css";

/** One theme in the gallery. */
export type ThemeCard = {
  id: string;
  name: string;
  /** The theme's art direction, in a sentence. */
  direction: string;
  /** The first page of the theme's example app, as HTML; null until it is read. */
  page: string | null;
};

/** The theme opened over the gallery. */
export type OpenedTheme = {
  id: string;
  name: string;
  /** The theme's example app to click through, or where reading it stands. */
  example: "loading" | "failed" | DesignFiles;
  /** The person asked for their app in this theme, with the look tweaks they made to it. */
  onUse: (tweaks: LookTweaks) => void;
};

export type DesignThemesViewProps = {
  /** The gallery's themes, or where reading them stands. */
  themes: "loading" | "failed" | readonly ThemeCard[];
  /** The theme the person opened; null shows the gallery. */
  opened: OpenedTheme | null;
  onOpen: (themeId: string) => void;
  onBack: () => void;
};

function ThemeCardButton({
  theme,
  onOpen,
}: {
  theme: ThemeCard;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.card}
      aria-label={wording.themes.open(theme.name)}
      onClick={onOpen}
    >
      {/* A still picture of the page: inert, so it neither takes focus nor eats the click. */}
      <span className={styles.thumb} aria-hidden="true" inert>
        {theme.page === null ? null : (
          <GuiFrame html={theme.page} scripts thumbnail />
        )}
      </span>
      <span className={styles.name}>{theme.name}</span>
      <span className={styles.direction} title={theme.direction}>
        {theme.direction}
      </span>
    </button>
  );
}

function ThemePreview({
  theme,
  onBack,
}: {
  theme: OpenedTheme;
  onBack: () => void;
}) {
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const [tweaks, setTweaks] = useState<LookTweaks>({});
  if (theme.example === "failed")
    return <InlineNote>{wording.themes.failed}</InlineNote>;
  if (theme.example === "loading")
    return <InlineNote>{wording.themes.loading}</InlineNote>;
  return (
    <MockupFrameView
      files={theme.example}
      device={device}
      onDevice={setDevice}
      onTweaks={setTweaks}
      fill
      // No design to save tweaks into: they travel in the message instead.
      tweakPanel={(panel) => (
        <TweakPanelView {...panel} onSave={null} saving={false} />
      )}
      leading={[
        [
          {
            id: "theme-gallery",
            label: wording.themes.back,
            text: theme.name,
            icon: <ArrowLeft size={16} aria-hidden="true" />,
            onSelect: onBack,
          },
        ],
      ]}
      trailing={[
        [
          {
            id: "use-theme",
            label: wording.themes.use,
            text: wording.themes.use,
            icon: <MessageSquarePlus size={16} aria-hidden="true" />,
            onSelect: () => theme.onUse(tweaks),
          },
        ],
      ]}
    />
  );
}

export function DesignThemesView({
  themes,
  opened,
  onOpen,
  onBack,
}: DesignThemesViewProps) {
  if (themes === "failed")
    return <InlineNote>{wording.themes.failed}</InlineNote>;
  if (themes === "loading")
    return <InlineNote>{wording.themes.loading}</InlineNote>;
  if (opened !== null)
    return <ThemePreview key={opened.id} theme={opened} onBack={onBack} />;
  return (
    <div className={styles.gallery} data-slot="design-themes">
      <p className={styles.lead}>{wording.themes.title}</p>
      <ul className={styles.grid} aria-label={wording.themes.gallery}>
        {themes.map((theme) => (
          <li key={theme.id}>
            <ThemeCardButton theme={theme} onOpen={() => onOpen(theme.id)} />
          </li>
        ))}
      </ul>
    </div>
  );
}
