import { FileText, Printer, Trash2 } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { wording } from "../../config.ts";
import {
  Panel,
  PanelActions,
  PanelClose,
  PanelContent,
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
import { DangerMenuItem } from "../../components.tsx";
import styles from "./artifact-pane.module.css";
import {
  DeliverableBody,
  type DeliverableSlots,
  type DeliverableState,
  fillsPane,
  type ReadVersion,
} from "./deliverable-block.tsx";
import type { DesignFiles } from "./design-bundle.ts";
import {
  draftBadge,
  MockupFrameView,
  type DesignPart,
} from "./design-preview.view.tsx";
import {
  conceptOfTab,
  conceptTab,
  type DesignConcept,
} from "./design-concept.ts";
import { UserManualView } from "./user-manual.view.tsx";
import type { UserManual } from "@corbits-builder/schemas/artifact";
import type { PreviewDevice } from "./device-preview.tsx";
import type { PassageQuote } from "./passage-note.tsx";
import {
  readStoredPreference,
  writeStoredPreference,
} from "../../stored-preference.ts";
import { printDocument } from "./print-document.ts";
import { DRAFT_TAB, LIVE_TAB } from "./tab-follow.ts";
import { useTabStrip } from "./tab-strip.ts";
import type { ApproachChoice } from "./approach-choice.ts";

/** A filed document as its tab shows it. */
export type PaneDocument = {
  /** Names its tab: the document's kind, or an attached file's own id. */
  id: string;
  title: string;
  /** Where it stands, in words: drafted at a version, or approved at one. */
  status: string;
  /** Its current version is one this viewer has not opened. */
  unread: boolean;
  /** An attached file, which the person can take back. */
  removable: boolean;
  /** A document the person can approve as they read it, with the version approved and when. */
  approval?: {
    approvedVersion: number | undefined;
    approvedAt: string | undefined;
  };
};

const TAB_PREFIX = "workspace-document";
// No pane carries this value, so the body shows none while no tab is selected yet.
const NO_TAB = "";
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
  selectedId: string | null;
  designPart: DesignPart;
}): string | null {
  const { side } = input;
  if (side === DRAFT_TAB && input.draftShown) return DRAFT_TAB;
  if (input.conceptShown) return side;
  if (side === LIVE_TAB && input.liveApp) return LIVE_TAB;
  if (side === MANUAL_TAB && input.manual) return MANUAL_TAB;
  if (side === THEMES_TAB && input.themes) return THEMES_TAB;
  if (input.selectedId === "design" && input.designPart === "mockup")
    return MOCKUP_TAB;
  return input.selectedId;
}
// The filed design is one document read as two tabs: its plan under the design's kind, its mockup here.
const MOCKUP_TAB = "design-mockup";

/**
 * What the pane shows when nothing is chosen: the live app once the build has started, else the
 * filed document furthest along the project's flow, else nothing.
 */
export function defaultTab(
  liveApp: boolean,
  documents: readonly PaneDocument[],
): string | null {
  if (liveApp) return LIVE_TAB;
  return documents.at(-1)?.id ?? null;
}

/**
 * The pane's selection once the person's choice is read: theirs when they made one; else, after a
 * reload, the default, which the pane shows itself when it is the live app and asks the page to
 * open when it is a document, so the document is read like any the person picks.
 */
export function resolveSelection(
  chosenId: string | null,
  liveApp: boolean,
  documents: readonly PaneDocument[],
  remembered: string | null = null,
): { selectedId: string | null; documentToOpen: string | null } {
  if (chosenId !== null) return { selectedId: chosenId, documentToOpen: null };
  // The document the person was on at their last visit, once it is here, beats the default.
  const id = remembered === MOCKUP_TAB ? "design" : remembered;
  if (id !== null && !isSideTab(id) && documents.some((item) => item.id === id))
    return { selectedId: null, documentToOpen: id };
  const fallback = defaultTab(liveApp, documents);
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
    documents: readonly PaneDocument[];
  },
): string | null {
  if (id === null) return null;
  if (id === LIVE_TAB) return have.liveApp ? id : null;
  if (id === MANUAL_TAB) return have.manual ? id : null;
  if (id === THEMES_TAB) return have.themes ? id : null;
  if (id === DRAFT_TAB) return have.draft ? id : null;
  const concept = conceptOfTab(id);
  if (concept !== undefined) return have.concepts.includes(concept) ? id : null;
  const document = id === MOCKUP_TAB ? "design" : id;
  return have.documents.some((item) => item.id === document) ? id : null;
}
const liveIds = panelTabIds(TAB_PREFIX, LIVE_TAB);
const THEMES_TAB = "design-themes";
const themesIds = panelTabIds(TAB_PREFIX, THEMES_TAB);
// A pane whose page fills it edge to edge: the app, a mockup, a spreadsheet or the design draft.
const FILL_PANE = styles.fill;
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

// Each document's tabs: one per document, two for the design.
function documentViews(
  item: PaneDocument,
): { value: string; label: string; part?: DesignPart }[] {
  const label = wording.documentTab[item.id] ?? item.title;
  if (item.id !== "design") return [{ value: item.id, label }];
  return [
    { value: item.id, label, part: "plan" },
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

/** The parts of the pane that read the hub for themselves, which whoever draws the pane fills. */
export type ArtifactPaneSlots = DeliverableSlots & {
  /** Once there is an app, filed or being built, or a build plan for one, a tab for it. */
  liveApp?: ReactElement | null;
  /** Before a design exists, prebuilt themes to preview, tweak and use through the composer. */
  themes?: ReactElement | null;
  /** One concept's mockup, at the device the pane keeps for the concepts. */
  conceptMockup: (
    concept: DesignConcept,
    frame: {
      device: PreviewDevice;
      onDevice: (device: PreviewDevice) => void;
    },
  ) => ReactNode;
};

/** What the pane shows and what the person can do in it. */
export type ArtifactPaneContent = {
  /** Names the browser's memory of the tab the person was on; without it the pane remembers nothing. */
  projectId?: string | undefined;
  /** Names the files the panes download and share. */
  projectTitle: string;
  /** The live designer's unfiled mockup, shown in its own tab until a design is filed. */
  draft?: DesignFiles | null;
  /** The app's user manual with its pictures, in its own tab once the coder has written it. */
  manual?: UserManual | null;
  /** The design concepts the person compares, a tab each, until one is picked. */
  concepts: readonly DesignConcept[];
  /** A tab the conversation asks for that is not a filed document, such as a concept. */
  openTab?: { value: string } | null;
  /** The filed documents, a tab each. */
  documents: readonly PaneDocument[];
  /** The document the pane reads, by its id. */
  selectedId: string | null;
  /** How the read of that document stands. */
  state: DeliverableState | undefined;
  onSelect: (id: string) => void;
  /** The person has the document open, so its current version is no longer unread. */
  onSeen: (id: string) => void;
  /** Takes an attached file back; absent where nothing can be removed. */
  onRemove?: ((id: string) => void) | undefined;
  onRetry?: (() => void) | undefined;
  onReadVersion?: (version: number) => Promise<ReadVersion>;
  onAddToPrompt?: (passage: PassageQuote) => void;
  onDeliverMessage?: ((message: string) => Promise<boolean | void>) | undefined;
  /** The person's pick of a filed approach, and how to make it; choosing is absent on an archived project. */
  approachChoice?: ApproachChoice;
  /** Approves a document at the version read, by its tab; absent on an archived project. */
  onApprove?: ((id: string, version: number) => Promise<void>) | undefined;
};

export type ArtifactPaneProps = ArtifactPaneContent &
  ArtifactPaneSlots & {
    /** The pane itself, for whoever moves focus to it. */
    paneRef?: Ref<HTMLElement>;
    /** The pane is in view; a closed one waits hidden, so nothing in it is being read. */
    open: boolean;
    /** Closes the pane, back to the conversation it opened over. */
    onClose: () => void;
  };

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
  concepts,
  openTab = null,
  liveApp = null,
  themes = null,
  conceptMockup,
  documents,
  selectedId,
  state,
  onSelect,
  onSeen,
  onRemove,
  paneRef,
  open,
  onClose,
  onRetry,
  onReadVersion,
  onAddToPrompt,
  onDeliverMessage,
  approachChoice,
  onApprove,
  approvalRounds,
  tweakPanel,
}: ArtifactPaneProps) {
  // A tab that is not a filed document: the design draft or the live app.
  const [side, setSide] = useState<string | null>(null);
  const [designPart, setDesignPart] = useState<DesignPart>("mockup");
  const [draftDevice, setDraftDevice] = useState<PreviewDevice>("desktop");
  const [conceptDevice, setConceptDevice] = useState<PreviewDevice>("desktop");
  // The document whose comparison with an earlier version is open.
  const [changesFor, setChangesFor] = useState<string | null>(null);
  const draftShown = draft !== null;
  const firstConcept = concepts[0]?.label;
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
    concepts: concepts.map((concept) => concept.label),
    documents,
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
        openTab.value === DRAFT_TAB ||
        openTab.value === MANUAL_TAB ||
        conceptOfTab(openTab.value) !== undefined
        ? openTab.value
        : null,
    );
    remember(openTab.value);
  }, [openTab]);
  const sideConcept = side === null ? undefined : conceptOfTab(side);
  const conceptShown = concepts.some(
    (concept) => concept.label === sideConcept,
  );
  const chosenId = selectTab({
    side,
    draftShown,
    conceptShown,
    liveApp: liveApp !== null,
    manual: manual !== null,
    themes: themes !== null,
    selectedId,
    designPart,
  });
  const { selectedId: tabId, documentToOpen } = resolveSelection(
    chosenId,
    liveApp !== null,
    documents,
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
  // The document on show: none while a tab that is not a filed document is open.
  const shown =
    (tabId !== null && isSideOnly(tabId)) || conceptShown
      ? undefined
      : documents.find((item) => item.id === selectedId);
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
  const print = (value: string) => {
    const item = documents.find((entry) => entry.id === value);
    const pane = document.getElementById(panelTabIds(TAB_PREFIX, value).pane);
    if (item !== undefined && pane !== null)
      printDocument(pane, item.title, item.status);
  };
  // The menu's remove item for an attached file's tab: a first click asks, the second removes.
  const removeItem = (value: string) => {
    const removable = documents.some(
      (item) => item.id === value && item.removable,
    );
    if (onRemove === undefined || !removable) return null;
    if (confirmingRemove)
      return (
        <DangerMenuItem onSelect={() => onRemove(value)}>
          <Trash2 size={16} aria-hidden="true" />
          {wording.removeAttachment.confirm}
        </DangerMenuItem>
      );
    return (
      <DangerMenuItem
        onSelect={(event) => {
          event.preventDefault();
          setConfirmingRemove(true);
        }}
      >
        <Trash2 size={16} aria-hidden="true" />
        {wording.removeAttachment.menu}
      </DangerMenuItem>
    );
  };
  const outputs = documents.length > 0 || draftShown || concepts.length > 0;
  const hasTabs =
    outputs || themes !== null || liveApp !== null || manual !== null;
  useEffect(() => {
    if (open && shown?.unread) onSeen(shown.id);
  }, [open, shown?.id, shown?.unread]);
  return (
    <Panel
      ref={paneRef}
      className={styles.pane}
      data-slot="artifact-pane"
      aria-label="Artifacts"
    >
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
            value={tabId}
            onValueChange={choose}
            idPrefix={TAB_PREFIX}
            ref={strip.ref}
            onScroll={strip.onScroll}
            onWheel={strip.onWheel}
          >
            {[
              ...documents.map((item) => {
                const unread = item.unread && item.id !== shown?.id;
                const status = unread
                  ? `${item.status}, ${wording.documentUnread}`
                  : item.status;
                return {
                  rank: flowRank(item.id),
                  tabs: documentViews(item).map((view) => (
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
                };
              }),
              // After the build plan when there is one; an app built from requirements alone, or
              // imported, has none.
              {
                rank: flowRank("build_plan"),
                tabs: [
                  liveApp !== null ? (
                    <PanelTab
                      key={LIVE_TAB}
                      value={LIVE_TAB}
                      title={wording.liveApp.title}
                    >
                      {wording.liveApp.tab}
                    </PanelTab>
                  ) : null,
                  manual !== null ? (
                    <PanelTab
                      key={MANUAL_TAB}
                      value={MANUAL_TAB}
                      title={wording.liveApp.manualTitle}
                    >
                      {wording.documentTab["user_manual"]}
                    </PanelTab>
                  ) : null,
                ],
              },
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
                tabs: concepts.map((concept, index) => (
                  <PanelTab
                    key={conceptTab(concept.label)}
                    value={conceptTab(concept.label)}
                    title={
                      concept.direction ??
                      wording.design.conceptTitle(concept.label)
                    }
                    {...(concept.content === undefined
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
                    {wording.design.conceptTab(index + 1, concept.label)}
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
                  className={styles.menuAnchor}
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
                {removeItem(tabMenu.value)}
              </MenuContent>
            </Menu>
          )}
          <PanelActions>
            <PanelClose
              label={wording.conversation.closeProject}
              title={wording.conversation.closeProject}
              onClick={onClose}
            />
          </PanelActions>
        </PanelHeader>
      ) : null}
      {!outputs && tabId === null ? (
        <div className={styles.content}>
          <div className={styles.empty}>
            <FileText size={28} aria-hidden="true" />
            <h2>What you make appears here</h2>
            <p>
              Keep the conversation going on the left. Documents, designs, code
              and previews show here as they are made.
            </p>
          </div>
        </div>
      ) : (
        <PanelContent
          value={tabId ?? NO_TAB}
          keepMounted
          className={styles.content}
        >
          {documents.flatMap((item) =>
            documentViews(item).map((view) => {
              const ids = panelTabIds(TAB_PREFIX, view.value);
              const current = view.value === tabId;
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
                    changesOpen={current && changesFor === item.id}
                    onToggleChanges={() =>
                      setChangesFor((open) =>
                        open === item.id ? null : item.id,
                      )
                    }
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
                    approval={
                      current &&
                      item.approval !== undefined &&
                      onApprove !== undefined
                        ? {
                            approvedVersion: item.approval.approvedVersion,
                            approvedAt: item.approval.approvedAt,
                            approve: (version) => onApprove(item.id, version),
                          }
                        : undefined
                    }
                    {...(current
                      ? {
                          onViewVersion: () => choose(view.value),
                          requestedVersion: requestedVersions[item.id],
                          onOpenSource: openSourceDocument,
                        }
                      : {})}
                    approvalRounds={approvalRounds}
                    tweakPanel={tweakPanel}
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
              {liveApp}
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
              {themes}
            </PanelPane>
          ) : null}
          {concepts.map((concept) => {
            const ids = panelTabIds(TAB_PREFIX, conceptTab(concept.label));
            return (
              <PanelPane
                key={concept.label}
                value={conceptTab(concept.label)}
                className={FILL_PANE}
                id={ids.pane}
                role="tabpanel"
                aria-labelledby={ids.tab}
              >
                {conceptMockup(concept, {
                  device: conceptDevice,
                  onDevice: setConceptDevice,
                })}
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
              <UserManualView manual={manual} />
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
              <MockupFrameView
                files={draft}
                device={draftDevice}
                onDevice={setDraftDevice}
                fill
                leading={[draftBadge(true)]}
                tweakPanel={tweakPanel}
              />
            </PanelPane>
          ) : null}
        </PanelContent>
      )}
    </Panel>
  );
}
