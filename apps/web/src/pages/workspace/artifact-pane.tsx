import { FileText, Printer, Trash2 } from "lucide-react";
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
  fillsPane,
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
import { UserManualPane } from "./user-manual.tsx";
import type { UserManual } from "@corbits-builder/schemas/artifact";
import { DesignThemes } from "./design-themes.tsx";
import type { PreviewDevice } from "./device-preview.tsx";
import type { PassageQuote } from "./passage-note.tsx";
import {
  useDocumentPaneWidth,
  writeDocumentPaneWidth,
} from "./document-pane-width.ts";
import { LiveApp } from "./live-app.tsx";
import {
  readStoredPreference,
  writeStoredPreference,
} from "../../stored-preference.ts";
import { markSeen, useSeenVersions } from "./seen-versions.ts";
import { useTipsGroup } from "./document-tips.tsx";
import { printDocument } from "./print-document.ts";
import { useTabStrip } from "./tab-strip.ts";
import type { ApproachChoice } from "./approach-choice.ts";
import {
  useWorkspaceApprovalsEnabled,
  type OnOff,
} from "../../workspace-approvals-setting.ts";

type Deliverable = ProjectArtifact;

function filterVisibleDeliverables(
  deliverables: readonly Deliverable[],
  approvalsEnabled: OnOff,
): readonly Deliverable[] {
  return approvalsEnabled === "on"
    ? deliverables
    : deliverables.filter((item) => item.kind !== "approval_package");
}

const TAB_PREFIX = "workspace-document";
const DRAFT_TAB = "design-draft";
// The page names each attached file's tab "material:<artifact id>"; only those can be taken back.
export const MATERIAL_TAB_PREFIX = "material:";
const removable = (id: string) => id.startsWith(MATERIAL_TAB_PREFIX);
const draftIds = panelTabIds(TAB_PREFIX, DRAFT_TAB);
const MANUAL_TAB = "user-manual";
const manualIds = panelTabIds(TAB_PREFIX, MANUAL_TAB);
// The tabs that are not filed documents: open while what they show is there. Read at call time,
// as some of these tabs are named further down.
const isSideOnly = (id: string) =>
  id === DRAFT_TAB || id === LIVE_TAB || id === MANUAL_TAB || id === THEMES_TAB;
const isSideTab = (id: string) =>
  isSideOnly(id) || conceptOfTab(id) !== undefined;

/** The tab that is open: a side tab while what it shows is there, else the chosen document. */
function selectTab(input: {
  side: string | null;
  draftShown: boolean;
  conceptShown: boolean;
  liveApp: boolean;
  manual: boolean;
  themes: boolean;
  selectedKind: string | undefined;
  designPart: DesignPart;
}): string | null {
  const { side } = input;
  if (side === DRAFT_TAB && input.draftShown) return DRAFT_TAB;
  if (input.conceptShown) return side;
  if (side === LIVE_TAB && input.liveApp) return LIVE_TAB;
  if (side === MANUAL_TAB && input.manual) return MANUAL_TAB;
  if (side === THEMES_TAB && input.themes) return THEMES_TAB;
  if (input.selectedKind === "design" && input.designPart === "mockup")
    return MOCKUP_TAB;
  return input.selectedKind ?? null;
}
// The filed design is one document read as two tabs: its plan under the design's kind, its mockup here.
const MOCKUP_TAB = "design-mockup";
export const LIVE_TAB = "live-app";

/**
 * What the pane shows when nothing is chosen: the live app once the build has started, else the
 * filed document furthest along the project's flow, else nothing.
 */
export function defaultTab(
  liveApp: boolean,
  deliverables: readonly Deliverable[],
): string | null {
  if (liveApp) return LIVE_TAB;
  return deliverables.at(-1)?.kind ?? null;
}

/**
 * The pane's selection once the person's choice is read: theirs when they made one; else, after a
 * reload, the default, which the pane shows itself when it is the live app and asks the page to
 * open when it is a document, so the document is read like any the person picks.
 */
export function resolveSelection(
  chosenId: string | null,
  liveApp: boolean,
  deliverables: readonly Deliverable[],
  remembered: string | null = null,
): { selectedId: string | null; documentToOpen: string | null } {
  if (chosenId !== null) return { selectedId: chosenId, documentToOpen: null };
  // The document the person was on at their last visit, once it is here, beats the default.
  const kind = remembered === MOCKUP_TAB ? "design" : remembered;
  if (
    kind !== null &&
    !isSideTab(kind) &&
    deliverables.some((item) => item.kind === kind)
  )
    return { selectedId: null, documentToOpen: kind };
  const fallback = defaultTab(liveApp, deliverables);
  return fallback === LIVE_TAB
    ? { selectedId: LIVE_TAB, documentToOpen: null }
    : { selectedId: null, documentToOpen: fallback };
}

/** Where the pane keeps the tab the person was on, per project, in this browser. */
export const paneTabKey = (projectId: string) => `sb.paneTab.${projectId}`;

/** The remembered tab when the pane can show it now, else null. */
export function availableTab(
  id: string | null,
  have: {
    liveApp: boolean;
    manual: boolean;
    themes: boolean;
    draft: boolean;
    concepts: readonly string[];
    deliverables: readonly Deliverable[];
  },
): string | null {
  if (id === null) return null;
  if (id === LIVE_TAB) return have.liveApp ? id : null;
  if (id === MANUAL_TAB) return have.manual ? id : null;
  if (id === THEMES_TAB) return have.themes ? id : null;
  if (id === DRAFT_TAB) return have.draft ? id : null;
  const concept = conceptOfTab(id);
  if (concept !== undefined) return have.concepts.includes(concept) ? id : null;
  const kind = id === MOCKUP_TAB ? "design" : id;
  return have.deliverables.some((item) => item.kind === kind) ? id : null;
}
const liveIds = panelTabIds(TAB_PREFIX, LIVE_TAB);
const THEMES_TAB = "design-themes";
const themesIds = panelTabIds(TAB_PREFIX, THEMES_TAB);
// A pane whose page fills it edge to edge: the app, a mockup, a spreadsheet or the design draft.
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
  "approval_package",
];
const flowRank = (kind: string) => {
  const rank = FLOW.indexOf(kind);
  return rank === -1 ? FLOW.length : rank;
};

// Keep messages, approval cards and the composer readable beside a wide preview.
const CONVERSATION_MIN_PX = 400;
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
  projectId,
  projectTitle,
  draft = null,
  manual = null,
  concepts = null,
  openTab = null,
  liveApp = null,
  themes = null,
  deliverables,
  selected,
  state,
  onSelect,
  onRemove,
  paneRef,
  changesOpen,
  onToggleChanges,
  onRetry,
  onReadVersion,
  onAddToPrompt,
  onDeliverMessage,
  approachChoice,
}: {
  /** Names the files the panes download and share. */
  /** Names the browser's memory of the tab the person was on; without it the pane remembers nothing. */
  projectId?: string | undefined;
  projectTitle: string;
  /** The live designer's unfiled mockup, shown in its own tab until a design is filed. */
  draft?: DesignFiles | null;
  /** The app's user manual with its pictures, in its own tab once the coder has written it. */
  manual?: UserManual | null;
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
  /** Takes an attached file back, for a tab that is one; absent where nothing can be removed. */
  onRemove?: ((id: string) => void) | undefined;
  paneRef?: Ref<HTMLElement>;
  changesOpen: boolean;
  onToggleChanges: () => void;
  onRetry?: (() => void) | undefined;
  onReadVersion?: (version: number) => Promise<ReadVersion>;
  onAddToPrompt?: (passage: PassageQuote) => void;
  onDeliverMessage?: ((message: string) => Promise<boolean | void>) | undefined;
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
  // The tab the person was on at their last visit to this project, until it is shown again or they
  // choose another; the pane's own jumps to new work wait for that.
  const memoryKey = projectId === undefined ? null : paneTabKey(projectId);
  const [memory, setMemory] = useState(() => ({
    key: memoryKey,
    id: memoryKey === null ? null : readStoredPreference(memoryKey),
  }));
  if (memory.key !== memoryKey)
    setMemory({
      key: memoryKey,
      id: memoryKey === null ? null : readStoredPreference(memoryKey),
    });
  const remember = (id: string) => {
    if (memoryKey !== null) writeStoredPreference(memoryKey, id);
  };
  const restoring = memory.id !== null;
  const restorable = availableTab(memory.id, {
    liveApp: liveApp !== null,
    manual: manual !== null,
    themes: themes !== null,
    draft: draftShown,
    concepts: conceptViews.map((view) => view.label),
    deliverables,
  });
  useEffect(() => {
    if (restorable === null) return;
    setMemory((current) => ({ ...current, id: null }));
    if (isSideTab(restorable)) {
      setSide(restorable);
      return;
    }
    // A document is opened through the page by resolveSelection; only the mockup's half is set here.
    if (restorable === MOCKUP_TAB) setDesignPart("mockup");
  }, [restorable]);
  // The draft opens once when it first appears, so the person watches the mockup take shape.
  useEffect(() => {
    if (draftShown && !restoring) {
      setSide(DRAFT_TAB);
      remember(DRAFT_TAB);
    }
  }, [draftShown]);
  // Likewise the first concept, when concepts start.
  const conceptsStarted = firstConcept !== undefined;
  useEffect(() => {
    if (firstConcept !== undefined && !restoring) {
      setSide(conceptTab(firstConcept));
      remember(conceptTab(firstConcept));
    }
  }, [conceptsStarted]);
  useEffect(() => {
    if (openTab === null) return;
    setSide(
      openTab.value === LIVE_TAB ||
        openTab.value === MANUAL_TAB ||
        conceptOfTab(openTab.value) !== undefined
        ? openTab.value
        : null,
    );
    remember(openTab.value);
  }, [openTab]);
  const sideConcept = side === null ? undefined : conceptOfTab(side);
  const conceptShown = conceptViews.some((view) => view.label === sideConcept);
  const chosenId = selectTab({
    side,
    draftShown,
    conceptShown,
    liveApp: liveApp !== null,
    manual: manual !== null,
    themes: themes !== null,
    selectedKind: selected?.kind,
    designPart,
  });
  const { selectedId, documentToOpen } = resolveSelection(
    chosenId,
    liveApp !== null,
    deliverables,
    memory.id,
  );
  // A document is chosen through the page, which reads it; the live app the pane shows itself.
  useEffect(() => {
    if (documentToOpen !== null) onSelect(documentToOpen);
  }, [documentToOpen]);
  const [requestedVersions, setRequestedVersions] = useState<
    Record<string, { version: number; seq: number }>
  >({});
  const choose = (id: string) => {
    remember(id);
    setMemory((current) =>
      current.id === null ? current : { ...current, id: null },
    );
    if (isSideTab(id)) return setSide(id);
    setSide(null);
    if (id === MOCKUP_TAB || id === "design")
      setDesignPart(id === MOCKUP_TAB ? "mockup" : "plan");
    onSelect(id === MOCKUP_TAB ? "design" : id);
  };
  const openSourceDocument = (kind: string, version: number) => {
    setRequestedVersions((current) => {
      const previous = current[kind];
      const nextSeq = previous === undefined ? 1 : previous.seq + 1;
      return {
        ...current,
        [kind]: {
          version,
          seq: nextSeq,
        },
      };
    });
    choose(kind);
  };
  const width = useDocumentPaneWidth(projectId);
  const seen = useSeenVersions();
  const tipsGroup = useTipsGroup();
  const shown =
    (selectedId !== null && isSideOnly(selectedId)) || conceptShown
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
  // Removing takes two clicks, both in the menu: the second item only exists after the first.
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const openTabMenu = (value: string, x: number, y: number) => {
    choose(value);
    setConfirmingRemove(false);
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
  const visibleDeliverables = filterVisibleDeliverables(
    deliverables,
    useWorkspaceApprovalsEnabled(),
  );
  const print = (value: string) => {
    const item = visibleDeliverables.find((entry) => entry.kind === value);
    const pane = document.getElementById(panelTabIds(TAB_PREFIX, value).pane);
    if (item !== undefined && pane !== null)
      printDocument(pane, item.title, documentStatus(item));
  };
  const outputs =
    visibleDeliverables.length > 0 || draftShown || conceptViews.length > 0;
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
      onWidthChange={(nextWidth) =>
        writeDocumentPaneWidth(projectId, nextWidth)
      }
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
              ...visibleDeliverables.map((item) => {
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
                    item.kind === "build_plan" && manual !== null ? (
                      <PanelTab
                        key={MANUAL_TAB}
                        value={MANUAL_TAB}
                        title={wording.liveApp.manualTitle}
                      >
                        {wording.documentTab["user_manual"]}
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
              onOpenChange={(open) => {
                if (open) return;
                setTabMenu(null);
                setConfirmingRemove(false);
              }}
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
                {onRemove === undefined ||
                !removable(tabMenu.value) ? null : confirmingRemove ? (
                  <MenuItem
                    className="menu-danger"
                    onSelect={() => onRemove(tabMenu.value)}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                    {wording.removeAttachment.confirm}
                  </MenuItem>
                ) : (
                  <MenuItem
                    className="menu-danger"
                    onSelect={(event) => {
                      event.preventDefault();
                      setConfirmingRemove(true);
                    }}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                    {wording.removeAttachment.menu}
                  </MenuItem>
                )}
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
          {visibleDeliverables.flatMap((item) =>
            documentViews(item).map((view) => {
              const ids = panelTabIds(TAB_PREFIX, view.value);
              const current = view.value === selectedId;
              return (
                <PanelPane
                  key={view.value}
                  value={view.value}
                  {...(view.part === "mockup" || (current && fillsPane(state))
                    ? { className: FILL_PANE }
                    : {})}
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
                    {...(current && onDeliverMessage !== undefined
                      ? { onDeliverMessage }
                      : {})}
                    {...(current && approachChoice !== undefined
                      ? { approachChoice }
                      : {})}
                    {...(current
                      ? {
                          onViewVersion: () => choose(view.value),
                          requestedVersion: requestedVersions[item.kind],
                          onOpenSource: openSourceDocument,
                        }
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
          {manual !== null ? (
            <PanelPane
              value={MANUAL_TAB}
              id={manualIds.pane}
              role="tabpanel"
              aria-labelledby={manualIds.tab}
            >
              <UserManualPane manual={manual} />
            </PanelPane>
          ) : null}
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
