/**
 * Projects: every project the person can see, as cards they can filter by
 * stage. The stage is the hub's, from native state; archived projects show
 * only under their own filter, where they can be restored.
 */
import { wording } from "../config.ts";
import {
  Badge,
  Button,
  EmptyState,
  FilterChip,
  LibraryPageHeader,
  formatRelativeTime,
  type BadgeTone,
} from "@corbits/react-ui";
import { Ellipsis, LayoutGrid, List, Plus } from "lucide-react";
import {
  useLibraryView,
  writeLibraryView,
  type ViewMode,
} from "../library-view-setting.ts";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { ProjectStage } from "@corbits-builder/schemas/project";
import type { ProjectSummary } from "../api/types.ts";
import type { NoticeAction } from "../components.jsx";
import { ProjectCover } from "./project-cover.tsx";
import { ProjectMenu } from "./project-menu.jsx";
import "./project-library.css";

type Filter = ProjectStage | "archived";
const FILTERS: readonly Filter[] = ["idea", "building", "shipped", "archived"];
const STAGE_TONE: Record<ProjectStage, BadgeTone> = {
  idea: "neutral",
  building: "info",
  shipped: "success",
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
    <div className="library-view" role="group" aria-label={text.label}>
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

export function ProjectLibrary({
  projects,
  loaded,
  failed,
  onOpen,
  onNewProject,
  onChanged,
  onError,
  onNotice,
}: {
  projects: readonly ProjectSummary[];
  /** The list has been read at least once. */
  loaded: boolean;
  failed: boolean;
  onOpen: (projectId: string) => void;
  onNewProject: () => void;
  onChanged: () => void;
  onError: (cause: unknown) => void;
  onNotice: (
    message: string,
    complete?: boolean,
    action?: NoticeAction,
  ) => void;
}) {
  const [filter, setFilter] = useState<Filter | null>(null);
  const view = useLibraryView();
  const sorted = projects.toSorted((a, b) =>
    b.lastActivityAt.localeCompare(a.lastActivityAt),
  );
  const visible = sorted.filter((project) => !project.archivedAt);
  const matching = (of: Filter) =>
    of === "archived"
      ? sorted.filter((project) => project.archivedAt)
      : visible.filter((project) => project.stage === of);
  const shown = filter === null ? visible : matching(filter);

  // A menu action can take its card out of the filter; focus then moves to the card now in its
  // place, or to the selected filter when none is left, rather than dropping to the page.
  const section = useRef<HTMLElement>(null);
  const changed = useRef<{
    id: string;
    index: number;
    before: typeof projects;
  } | null>(null);
  useEffect(() => {
    const pending = changed.current;
    if (pending === null || pending.before === projects) return;
    changed.current = null;
    if (shown.some((project) => project.id === pending.id)) return;
    const cards =
      section.current?.querySelectorAll<HTMLElement>(".library-card-open") ??
      [];
    const next =
      cards[Math.min(pending.index, cards.length - 1)] ??
      section.current?.querySelector<HTMLElement>(
        ".library-filters [aria-pressed='true']",
      );
    next?.focus();
  }, [projects, shown]);

  let body: ReactNode;
  if (!loaded)
    body = (
      <p role="status" className="library-note">
        {failed ? wording.library.failed : wording.library.loading}
      </p>
    );
  else if (shown.length === 0)
    body =
      filter === null ? (
        <EmptyState
          title={
            sorted.length === 0
              ? wording.library.emptyTitle
              : wording.library.allArchivedTitle
          }
          description={
            sorted.length === 0
              ? wording.library.emptyLead
              : wording.library.allArchivedLead
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
      <ul className="library-grid" data-view={view}>
        {shown.map((project, index) => {
          const cover = coverOf(project.id);
          return (
            <li key={project.id} className="library-card">
              <button
                type="button"
                className="library-card-open"
                onClick={() => onOpen(project.id)}
              >
                <ProjectCover
                  projectId={project.id}
                  pattern={cover.pattern}
                  style={cover.style}
                  mockup={view === "grid"}
                />
                <span className="library-card-body">
                  <span className="library-card-title">{project.title}</span>
                  <span className="library-card-meta">
                    <Badge
                      tone={
                        project.archivedAt
                          ? "neutral"
                          : STAGE_TONE[project.stage]
                      }
                    >
                      {
                        wording.library.filter[
                          project.archivedAt ? "archived" : project.stage
                        ]
                      }
                    </Badge>
                    <time dateTime={project.lastActivityAt}>
                      {wording.library.lastActivity(
                        formatRelativeTime(project.lastActivityAt),
                      )}
                    </time>
                  </span>
                </span>
              </button>
              <ProjectMenu
                project={project}
                trigger={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="library-card-menu"
                    aria-label={wording.shell.projectOptions(project.title)}
                  >
                    <Ellipsis aria-hidden="true" />
                  </Button>
                }
                onChanged={() => {
                  changed.current = {
                    id: project.id,
                    index,
                    before: projects,
                  };
                  onChanged();
                }}
                onError={onError}
                onNotice={onNotice}
              />
            </li>
          );
        })}
      </ul>
    );
  return (
    <section className="library-page" ref={section}>
      <LibraryPageHeader
        title={wording.library.title}
        subtitle={wording.library.subtitle}
      >
        <div
          className="library-filters"
          role="group"
          aria-label={wording.library.filterLabel}
        >
          <FilterChip
            selected={filter === null}
            onClick={() => setFilter(null)}
          >
            {wording.library.all}
          </FilterChip>
          {FILTERS.map((item) => (
            <FilterChip
              key={item}
              selected={filter === item}
              {...(loaded ? { count: matching(item).length } : {})}
              onClick={() => setFilter(item)}
            >
              {wording.library.filter[item]}
            </FilterChip>
          ))}
        </div>
        <ViewToggle mode={view} onChange={writeLibraryView} />
        <Button variant="primary" onClick={onNewProject}>
          <Plus aria-hidden="true" />
          {wording.shell.newProject}
        </Button>
      </LibraryPageHeader>
      {body}
    </section>
  );
}
