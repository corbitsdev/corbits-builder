/**
 * The Projects page as it looks: the projects as cards, tiles or a list,
 * under the stage filters.
 */
import { wording } from "../config.ts";
import {
  Badge,
  Button,
  EmptyState,
  FilterChip,
  LibraryPageHeader,
  type BadgeTone,
} from "@corbits/react-ui";
import { Ellipsis, LayoutGrid, List, Plus } from "lucide-react";
import {
  useEffect,
  useRef,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import type { ProjectStage } from "@corbits-builder/schemas/project";
import type { ViewMode } from "../library-view-setting.ts";
import { ProjectCoverView } from "./project-cover.view.tsx";
import styles from "./project-library.module.css";

export type LibraryFilter = ProjectStage | "archived";

/** A project as its card shows it. */
export type LibraryProject = {
  id: string;
  title: string;
  /** What its badge says: its stage, or archived whatever stage it reached. */
  stage: LibraryFilter;
  /** When it was last worked on, as an ISO time and as the card words it ("2 hours ago"). */
  lastActivityAt: string;
  lastActive: string;
  /** The first page of its design, which a tile shows as its cover; null leaves the cover its pattern. */
  mockup: string | null;
};

export type ProjectLibraryViewProps = {
  /** Whether the projects have been read, are still being read, or could not be. */
  status: "loading" | "failed" | "ready";
  /** The filter pressed; null is All, every project that is not archived. */
  filter: LibraryFilter | null;
  onFilterChange: (filter: LibraryFilter | null) => void;
  /** How many projects each filter holds, shown once they have been read. */
  counts: Readonly<Record<LibraryFilter, number>>;
  /** The projects the filter leaves, in the order to show them. */
  projects: readonly LibraryProject[];
  layout: ViewMode;
  onLayoutChange: (layout: ViewMode) => void;
  onOpen: (projectId: string) => void;
  onNewProject: () => void;
  /** A card's cover has come within a screen of the viewport, which is when its mockup is worth reading. */
  onCoverNear: (projectId: string) => void;
  /** A card's options menu, opened by the trigger the page draws for it. */
  menu: (projectId: string, trigger: ReactElement) => ReactNode;
  /**
   * Set when a menu action has taken its card out of the filter: focus moves to the card now at
   * that place, or to the pressed filter when none is left, rather than dropping to the page.
   */
  focusAfterChange: { index: number } | null;
};

const FILTERS: readonly LibraryFilter[] = [
  "idea",
  "building",
  "shipped",
  "archived",
];
const STAGE_TONE: Record<LibraryFilter, BadgeTone> = {
  idea: "neutral",
  building: "info",
  shipped: "success",
  archived: "neutral",
};
const COVER_TOKENS = [
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--primary",
  "--secondary",
  "--success",
] as const;
const COVER_PATTERNS = [
  "linear",
  "radial",
  "stripes",
  "rings",
  "mesh",
] as const;

/** FNV-1a: the same id always draws the same cover. */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

/** A cover drawn from the theme's tokens, so it follows light and dark. */
function coverOf(projectId: string) {
  const seed = hash(projectId);
  const first = seed % COVER_TOKENS.length;
  const second =
    (first + 1 + ((seed >>> 3) % (COVER_TOKENS.length - 1))) %
    COVER_TOKENS.length;
  return {
    pattern: COVER_PATTERNS[(seed >>> 6) % COVER_PATTERNS.length]!,
    style: {
      "--cover-a": `var(${COVER_TOKENS[first]!})`,
      "--cover-b": `var(${COVER_TOKENS[second]!})`,
      "--cover-angle": `${String((seed >>> 9) % 360)}deg`,
      "--cover-x": `${String(15 + ((seed >>> 17) % 70))}%`,
      "--cover-y": `${String(15 + ((seed >>> 24) % 70))}%`,
    } as CSSProperties,
  };
}

/**
 * Tiles or a list, as two pressed-state buttons in a group: each names itself for assistive tech,
 * and the page owns the choice, which outlives the page.
 */
function ViewToggle({
  mode,
  onChange,
}: {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
}) {
  const text = wording.library.view;
  return (
    <div className={styles.view} role="group" aria-label={text.label}>
      <Button
        variant={mode === "grid" ? "outline" : "ghost"}
        size="icon"
        aria-pressed={mode === "grid"}
        aria-label={text.grid}
        onClick={() => onChange("grid")}
      >
        <LayoutGrid aria-hidden="true" />
      </Button>
      <Button
        variant={mode === "rows" ? "outline" : "ghost"}
        size="icon"
        aria-pressed={mode === "rows"}
        aria-label={text.rows}
        onClick={() => onChange("rows")}
      >
        <List aria-hidden="true" />
      </Button>
    </div>
  );
}

export function ProjectLibraryView({
  status,
  filter,
  onFilterChange,
  counts,
  projects,
  layout,
  onLayoutChange,
  onOpen,
  onNewProject,
  onCoverNear,
  menu,
  focusAfterChange,
}: ProjectLibraryViewProps) {
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focusAfterChange === null) return;
    const root = section.current;
    if (root === null) return;
    const cards = root.querySelectorAll<HTMLElement>("[data-card-open]");
    const next =
      cards[Math.min(focusAfterChange.index, cards.length - 1)] ??
      root.querySelector<HTMLElement>("[data-filters] [aria-pressed='true']");
    next?.focus();
  }, [focusAfterChange]);

  // With nothing under All, either there are no projects or every one is archived.
  const allArchived = counts.archived > 0;
  let body: ReactNode;
  if (status !== "ready")
    body = (
      <p role="status" className={styles.note}>
        {status === "failed" ? wording.library.failed : wording.library.loading}
      </p>
    );
  else if (projects.length === 0)
    body =
      filter === null ? (
        <EmptyState
          title={
            allArchived
              ? wording.library.allArchivedTitle
              : wording.library.emptyTitle
          }
          description={
            allArchived
              ? wording.library.allArchivedLead
              : wording.library.emptyLead
          }
          action={
            <Button variant="primary" onClick={onNewProject}>
              {wording.shell.newProject}
            </Button>
          }
        />
      ) : (
        <EmptyState
          title={wording.library.emptyFilterTitle(
            wording.library.filter[filter],
          )}
          description={wording.library.emptyFilterLead}
        />
      );
  else
    body = (
      <ul className={styles.grid} data-view={layout}>
        {projects.map((project) => {
          const cover = coverOf(project.id);
          return (
            <li key={project.id} className={styles.card}>
              <button
                type="button"
                className={styles.cardOpen}
                data-card-open=""
                onClick={() => onOpen(project.id)}
              >
                <ProjectCoverView
                  pattern={cover.pattern}
                  style={cover.style}
                  mockup={project.mockup}
                  onNear={() => onCoverNear(project.id)}
                />
                <span className={styles.cardBody}>
                  <span className={styles.cardTitle}>{project.title}</span>
                  <span className={styles.cardMeta}>
                    <Badge tone={STAGE_TONE[project.stage]}>
                      {wording.library.filter[project.stage]}
                    </Badge>
                    <time dateTime={project.lastActivityAt}>
                      {wording.library.lastActivity(project.lastActive)}
                    </time>
                  </span>
                </span>
              </button>
              {menu(
                project.id,
                <Button
                  variant="ghost"
                  size="icon"
                  className={styles.cardMenu}
                  aria-label={wording.shell.projectOptions(project.title)}
                >
                  <Ellipsis aria-hidden="true" />
                </Button>,
              )}
            </li>
          );
        })}
      </ul>
    );
  return (
    <section className={styles.page} ref={section}>
      <LibraryPageHeader
        title={wording.library.title}
        subtitle={wording.library.subtitle}
      >
        <div
          className={styles.filters}
          data-filters=""
          role="group"
          aria-label={wording.library.filterLabel}
        >
          <FilterChip
            selected={filter === null}
            onClick={() => onFilterChange(null)}
          >
            {wording.library.all}
          </FilterChip>
          {FILTERS.map((item) => (
            <FilterChip
              key={item}
              selected={filter === item}
              {...(status === "ready" ? { count: counts[item] } : {})}
              onClick={() => onFilterChange(item)}
            >
              {wording.library.filter[item]}
            </FilterChip>
          ))}
        </div>
        <ViewToggle mode={layout} onChange={onLayoutChange} />
        <Button variant="primary" onClick={onNewProject}>
          <Plus aria-hidden="true" />
          {wording.shell.newProject}
        </Button>
      </LibraryPageHeader>
      {body}
    </section>
  );
}
