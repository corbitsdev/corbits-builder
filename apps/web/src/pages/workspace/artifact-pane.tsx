import { FileText, Printer } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type Ref,
} from "react";
import { wording } from "../../config.ts";
import type { ProjectArtifact } from "@corbits-builder/client";
import type { InFlightRun } from "@corbits-builder/schemas/artifact";
import {
  Panel,
  PanelContent,
  PanelHandle,
  PanelHeader,
  PanelPane,
  PanelTab,
  PanelTabs,
  panelTabIds,
  StatusDot,
} from "@corbits/react-ui";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
} from "@corbits/react-ui/ui/menu";
import {
  DeliverableBody,
  type DeliverableState,
  type ReadVersion,
} from "./deliverable-block.tsx";
import {
  MockupFrame,
  type DesignFiles,
  type DesignPart,
} from "./design-preview.tsx";
import {
  ConceptMockup,
  conceptOfTab,
  conceptTab,
  type ConceptView,
} from "./design-concepts.tsx";
import { DesignThemes } from "./design-themes.tsx";
import type { PreviewDevice } from "./device-preview.tsx";
import type { PassageQuote } from "./passage-note.tsx";
import {
  useDocumentPaneWidth,
  writeDocumentPaneWidth,
} from "./document-pane-width.ts";
import { LiveApp } from "./live-app.tsx";
import { markSeen, useSeenVersions } from "./seen-versions.ts";
import { useTipsGroup } from "./document-tips.tsx";
import { printDocument } from "./print-document.ts";
import { useTabStrip } from "./tab-strip.ts";
import type { ApproachChoice } from "./approach-choice.ts";

type Deliverable = ProjectArtifact;

const TAB_PREFIX = "workspace-document";
const DRAFT_TAB = "design-draft";
const draftIds = panelTabIds(TAB_PREFIX, DRAFT_TAB);
// The filed design is one document read as two tabs: its plan under the design's kind, its mockup here.
const MOCKUP_TAB = "design-mockup";
export const LIVE_TAB = "live-app";
const liveIds = panelTabIds(TAB_PREFIX, LIVE_TAB);
const THEMES_TAB = "design-themes";
const themesIds = panelTabIds(TAB_PREFIX, THEMES_TAB);
// A pane whose page fills it edge to edge: the app, a mockup or the design draft.
const FILL_PANE = "workspace-pane-fill";
const POINTER_TABS = "data-pointer-tabs";
const TAB_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "Tab",
  "Enter",
  " ",
]);

// Each deliverable's tabs: one per document, two for the design.
function documentViews(
  item: Deliverable,
): { value: string; label: string; part?: DesignPart }[] {
  const label = wording.documentTab[item.kind] ?? item.title;
  if (item.kind !== "design") return [{ value: item.kind, label }];
  return [
    { value: item.kind, label, part: "plan" },
    { value: MOCKUP_TAB, label: wording.design.mockupTab, part: "mockup" },
  ];
}
// Tabs follow the project's flow; a kind outside it comes last.
const FLOW = [
  "problem_brief",
  "constraints",
  "approaches",
  "product_requirements",
  "design",
  "build_plan",
];
const flowRank = (kind: string) => {
  const rank = FLOW.indexOf(kind);
  return rank === -1 ? FLOW.length : rank;
};

// The document may take most of the row; the conversation folds away entirely when it needs all of it.
const CONVERSATION_MIN_PX = 240;
const DOCUMENT_MIN_PX = 360;

function documentStatus(item: Deliverable): string {
  return item.approvedVersion === undefined
    ? wording.documentStatus.drafted(item.version)
    : wording.documentStatus.approved(item.approvedVersion);
}

/**
 * One tab per open document, using the vendored panel tabs. A tab is marked
 * only while its current version is one this viewer has not opened. Panes
 * stay mounted so a later editor can keep its place.
 */
export function ArtifactPane({
  projectTitle,
  draft = null,
  concepts = null,
  openTab = null,
  liveApp = null,
  themes = null,
  deliverables,
  selected,
  state,
  onSelect,
  paneRef,
  changesOpen,
  onToggleChanges,
  onRetry,
  onReadVersion,
  onAddToPrompt,
  approachChoice,
}: {
  /** Names the files the panes download and share. */
  projectTitle: string;
  /** The live designer's unfiled mockup, shown in its own tab until a design is filed. */
  draft?: DesignFiles | null;
  /** The design concepts the person compares, a tab each, until one is picked. */
  concepts?: { projectId: string; views: readonly ConceptView[] } | null;
  /** A tab the conversation asks for that is not a filed document, such as a concept. */
  openTab?: { value: string } | null;
  /** Once a build plan is filed, a tab for the app it builds. */
  liveApp?: { projectId: string; builder?: InFlightRun | undefined } | null;
  /** Before a design exists, prebuilt themes to preview, tweak and use through the composer. */
  themes?: { projectId: string; onUse: (message: string) => void } | null;
  deliverables: readonly Deliverable[];
  selected: Deliverable | null;
  state: DeliverableState | undefined;
  onSelect: (id: string) => void;
  paneRef?: Ref<HTMLElement>;
  changesOpen: boolean;
  onToggleChanges: () => void;
  onRetry?: (() => void) | undefined;
  onReadVersion?: (version: number) => Promise<ReadVersion>;
  onAddToPrompt?: (passage: PassageQuote) => void;
  /** The person's pick of a filed approach, and how to make it; choosing is absent on an archived project. */
  approachChoice?: ApproachChoice;
}) {
  // A tab that is not a filed document: the design draft or the live app.
  const [side, setSide] = useState<string | null>(null);
  const [designPart, setDesignPart] = useState<DesignPart>("mockup");
  const [draftDevice, setDraftDevice] = useState<PreviewDevice>("desktop");
  const [conceptDevice, setConceptDevice] = useState<PreviewDevice>("desktop");
  const draftShown = draft !== null;
  const conceptViews = concepts?.views ?? [];
  const firstConcept = conceptViews[0]?.label;
  // The draft opens once when it first appears, so the person watches the mockup take shape.
  useEffect(() => {
    if (draftShown) setSide(DRAFT_TAB);
  }, [draftShown]);
  // Likewise the first concept, when concepts start.
  const conceptsStarted = firstConcept !== undefined;
  useEffect(() => {
    if (firstConcept !== undefined) setSide(conceptTab(firstConcept));
  }, [conceptsStarted]);
  useEffect(() => {
    if (openTab !== null)
      setSide(
        openTab.value === LIVE_TAB || conceptOfTab(openTab.value) !== undefined
          ? openTab.value
          : null,
      );
  }, [openTab]);
  const sideConcept = side === null ? undefined : conceptOfTab(side);
  const conceptShown = conceptViews.some((view) => view.label === sideConcept);
  const selectedId =
    side === DRAFT_TAB && draftShown
      ? DRAFT_TAB
      : conceptShown
        ? side
        : side === LIVE_TAB && liveApp !== null
          ? LIVE_TAB
          : side === THEMES_TAB && themes !== null
            ? THEMES_TAB
            : selected?.kind === "design" && designPart === "mockup"
              ? MOCKUP_TAB
              : (selected?.kind ?? null);
  const choose = (id: string) => {
    if (
      id === DRAFT_TAB ||
      id === LIVE_TAB ||
      id === THEMES_TAB ||
      conceptOfTab(id) !== undefined
    )
      return setSide(id);
    setSide(null);
    if (id === MOCKUP_TAB || id === "design")
      setDesignPart(id === MOCKUP_TAB ? "mockup" : "plan");
    onSelect(id === MOCKUP_TAB ? "design" : id);
  };
  const width = useDocumentPaneWidth();
  const seen = useSeenVersions();
  const tipsGroup = useTipsGroup();
  const shown =
    selectedId === DRAFT_TAB ||
    selectedId === LIVE_TAB ||
    selectedId === THEMES_TAB ||
    conceptShown
      ? null
      : selected;
  const strip = useTabStrip();
  // A written document's tab has a menu, by right-click or Shift+F10, that prints it; a mockup is a
  // page of its own. Opening the menu selects the tab, so its pane is the one printed.
  const [tabMenu, setTabMenu] = useState<{
    value: string;
    x: number;
    y: number;
  } | null>(null);
  const printing = useRef<string | null>(null);
  const openTabMenu = (value: string, x: number, y: number) => {
    choose(value);
    setTabMenu({ value, x, y });
  };
  const tabMenuProps = (value: string) => ({
    onContextMenu: (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      openTabMenu(value, event.clientX, event.clientY);
    },
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      if (
        event.key !== "ContextMenu" &&
        !(event.shiftKey && event.key === "F10")
      )
        return;
      event.preventDefault();
      const tab = event.currentTarget.getBoundingClientRect();
      openTabMenu(value, tab.left, tab.bottom);
    },
  });
  const print = (value: string) => {
    const item = deliverables.find((entry) => entry.kind === value);
    const pane = document.getElementById(panelTabIds(TAB_PREFIX, value).pane);
    if (item !== undefined && pane !== null)
      printDocument(pane, item.title, documentStatus(item));
  };
  const outputs =
    deliverables.length > 0 || draftShown || conceptViews.length > 0;
  const hasTabs = outputs || themes !== null;
  useEffect(() => {
    if (shown !== null) markSeen(seen, shown.artifactId, shown.version);
  }, [seen, shown]);
  return (
    <Panel
      ref={paneRef}
      className="workspace-artifacts"
      aria-label="Artifacts"
      width={width}
      onWidthChange={writeDocumentPaneWidth}
      minWidth={DOCUMENT_MIN_PX}
      mainMinWidth={CONVERSATION_MIN_PX}
    >
      <PanelHandle label="Resize the document pane" />
      {hasTabs ? (
        <PanelHeader
          // Chromium rings a clicked tab once any key is pressed, a modifier included, so a tab
          // chosen by pointer stays ringless until the keyboard actually moves between tabs.
          onPointerDown={(event) =>
            event.currentTarget.setAttribute(POINTER_TABS, "")
          }
          onKeyDown={(event) => {
            if (TAB_KEYS.has(event.key))
              event.currentTarget.removeAttribute(POINTER_TABS);
          }}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget))
              event.currentTarget.removeAttribute(POINTER_TABS);
          }}
        >
          <PanelTabs
            label="Documents"
            value={selectedId}
            onValueChange={choose}
            idPrefix={TAB_PREFIX}
            ref={strip.ref}
            onScroll={strip.onScroll}
            onWheel={strip.onWheel}
          >
            {[
              ...deliverables.map((item) => {
                const unread =
                  item.kind !== shown?.kind &&
                  seen[item.artifactId] !== item.version;
                const status = unread
                  ? `${documentStatus(item)}, ${wording.documentUnread}`
                  : documentStatus(item);
                return {
                  rank: flowRank(item.kind),
                  tabs: [
                    ...documentViews(item).map((view) => (
                      <PanelTab
                        key={view.value}
                        value={view.value}
                        title={`${item.title}. ${status}`}
                        aria-label={`${view.label}, ${status}`}
                        icon={
                          unread ? (
                            <StatusDot label="" size="xs" tone="emphasis" />
                          ) : undefined
                        }
                        {...(view.part === "mockup"
                          ? {}
                          : tabMenuProps(view.value))}
                      >
                        {view.label}
                      </PanelTab>
                    )),
                    item.kind === "build_plan" && liveApp !== null ? (
                      <PanelTab
                        key={LIVE_TAB}
                        value={LIVE_TAB}
                        title={wording.liveApp.title}
                      >
                        {wording.liveApp.tab}
                      </PanelTab>
                    ) : null,
                  ],
                };
              }),
              ...(draftShown
                ? [
                    {
                      rank: flowRank("design"),
                      tabs: [
                        <PanelTab
                          key={DRAFT_TAB}
                          value={DRAFT_TAB}
                          title={wording.design.draftInProgress}
                          icon={
                            <StatusDot
                              label=""
                              size="xs"
                              tone="emphasis"
                              live
                            />
                          }
                        >
                          {wording.design.mockupTab}
                        </PanelTab>,
                      ],
                    },
                  ]
                : []),
              ...(themes !== null
                ? [
                    {
                      rank: flowRank("design"),
                      tabs: [
                        <PanelTab
                          key={THEMES_TAB}
                          value={THEMES_TAB}
                          title={wording.themes.title}
                        >
                          {wording.themes.tab}
                        </PanelTab>,
                      ],
                    },
                  ]
                : []),
              {
                rank: flowRank("design"),
                tabs: conceptViews.map((view, index) => (
                  <PanelTab
                    key={conceptTab(view.label)}
                    value={conceptTab(view.label)}
                    title={
                      view.direction ?? wording.design.conceptTitle(view.label)
                    }
                    {...(view.content === undefined
                      ? {
                          icon: (
                            <StatusDot
                              label=""
                              size="xs"
                              tone="emphasis"
                              live
                            />
                          ),
                        }
                      : {})}
                  >
                    {wording.design.conceptTab(index + 1, view.label)}
                  </PanelTab>
                )),
              },
            ]
              .sort((left, right) => left.rank - right.rank)
              .flatMap((entry) => entry.tabs)}
          </PanelTabs>
          {tabMenu === null ? null : (
            <Menu
              open
              onOpenChange={(open) => (open ? undefined : setTabMenu(null))}
            >
              <MenuTrigger asChild>
                <span
                  className="document-tab-menu-anchor"
                  style={{ left: tabMenu.x, top: tabMenu.y }}
                  aria-hidden="true"
                />
              </MenuTrigger>
              <MenuContent
                align="start"
                onCloseAutoFocus={(event) => {
                  event.preventDefault();
                  document
                    .getElementById(panelTabIds(TAB_PREFIX, tabMenu.value).tab)
                    ?.focus();
                  const value = printing.current;
                  printing.current = null;
                  if (value !== null) print(value);
                }}
              >
                <MenuItem onSelect={() => (printing.current = tabMenu.value)}>
                  <Printer size={16} aria-hidden="true" />
                  {wording.printDocument}
                </MenuItem>
              </MenuContent>
            </Menu>
          )}
        </PanelHeader>
      ) : null}
      {!outputs && selectedId === null ? (
        <div className="workspace-artifact-content">
          <div className="workspace-artifact-empty">
            <FileText size={28} aria-hidden="true" />
            <h2>Your outputs appear here</h2>
            <p>
              Keep the conversation going on the left. Documents and design
              previews will be available here as they are written.
            </p>
          </div>
        </div>
      ) : (
        <PanelContent
          value={selectedId ?? ""}
          keepMounted
          className="workspace-artifact-content"
        >
          {deliverables.flatMap((item) =>
            documentViews(item).map((view) => {
              const ids = panelTabIds(TAB_PREFIX, view.value);
              const current = view.value === selectedId;
              return (
                <PanelPane
                  key={view.value}
                  value={view.value}
                  {...(view.part === "mockup" ? { className: FILL_PANE } : {})}
                  id={ids.pane}
                  role="tabpanel"
                  aria-labelledby={ids.tab}
                >
                  <DeliverableBody
                    state={current ? state : undefined}
                    {...(view.part === undefined
                      ? {}
                      : { designPart: view.part })}
                    fileName={{ project: projectTitle, document: view.label }}
                    changesOpen={current && changesOpen}
                    onToggleChanges={onToggleChanges}
                    {...(current && onRetry !== undefined ? { onRetry } : {})}
                    {...(current && onReadVersion !== undefined
                      ? { onReadVersion }
                      : {})}
                    {...(current && onAddToPrompt !== undefined
                      ? { onAddToPrompt }
                      : {})}
                    {...(current && approachChoice !== undefined
                      ? { approachChoice }
                      : {})}
                    {...(current
                      ? { onViewVersion: () => choose(view.value) }
                      : {})}
                  />
                </PanelPane>
              );
            }),
          )}
          {liveApp !== null ? (
            <PanelPane
              value={LIVE_TAB}
              className={FILL_PANE}
              id={liveIds.pane}
              role="tabpanel"
              aria-labelledby={liveIds.tab}
            >
              <LiveApp
                projectId={liveApp.projectId}
                builder={liveApp.builder}
                trailing={[tipsGroup]}
              />
            </PanelPane>
          ) : null}
          {themes !== null ? (
            <PanelPane
              value={THEMES_TAB}
              className={FILL_PANE}
              id={themesIds.pane}
              role="tabpanel"
              aria-labelledby={themesIds.tab}
            >
              <DesignThemes
                projectId={themes.projectId}
                onUse={themes.onUse}
                trailing={[tipsGroup]}
              />
            </PanelPane>
          ) : null}
          {concepts === null
            ? null
            : conceptViews.map((view) => {
                const ids = panelTabIds(TAB_PREFIX, conceptTab(view.label));
                return (
                  <PanelPane
                    key={view.label}
                    value={conceptTab(view.label)}
                    className={FILL_PANE}
                    id={ids.pane}
                    role="tabpanel"
                    aria-labelledby={ids.tab}
                  >
                    <ConceptMockup
                      projectId={concepts.projectId}
                      concept={view}
                      device={conceptDevice}
                      onDevice={setConceptDevice}
                      trailing={[tipsGroup]}
                    />
                  </PanelPane>
                );
              })}
          {draftShown ? (
            <PanelPane
              value={DRAFT_TAB}
              className={FILL_PANE}
              id={draftIds.pane}
              role="tabpanel"
              aria-labelledby={draftIds.tab}
            >
              <MockupFrame
                files={draft}
                device={draftDevice}
                onDevice={setDraftDevice}
                leading={[
                  [
                    {
                      id: "draft",
                      label: wording.design.draftInProgress,
                      text: wording.design.draftBadge,
                      icon: (
                        <StatusDot label="" size="xs" tone="emphasis" live />
                      ),
                      note: true,
                    },
                  ],
                ]}
                trailing={[tipsGroup]}
              />
            </PanelPane>
          ) : null}
        </PanelContent>
      )}
    </Panel>
  );
}
