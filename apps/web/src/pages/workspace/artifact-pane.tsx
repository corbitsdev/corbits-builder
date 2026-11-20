import { FileText } from "lucide-react";
import {
  useEffect,
  useState,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { wording } from "../../config.ts";
import { Panel, PanelContent, PanelPane, panelTabIds } from "@corbits/react-ui";
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
import type { UserManual } from "@corbits-builder/schemas/artifact";
import type { PreviewDevice } from "./device-preview.tsx";
import type { PassageQuote } from "./passage-quote.ts";
import {
  readStoredPreference,
  writeStoredPreference,
} from "../../stored-preference.ts";
import { printDocument } from "./print-document.ts";
import { DRAFT_TAB, LIVE_TAB, MANUAL_TAB, MOCKUP_TAB } from "./tab-follow.ts";
import type { ApproachChoice } from "./approach-choice.ts";
import type { PluginTab } from "./plugin-screens.tsx";
import { splitLeadingHeading } from "./reading-selection.ts";
import {
  WrittenDocumentView,
  type WrittenDocumentViewProps,
} from "./written-document.view.tsx";

/** A filed document as the pane shows it. */
export type PaneDocument = {
  /** Names its pane: the document's kind, or an attached file's own id. */
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
const manualIds = panelTabIds(TAB_PREFIX, MANUAL_TAB);
// The tabs that are not filed documents: open while what they show is there.
const isSideOnly = (id: string) =>
  id === DRAFT_TAB || id === LIVE_TAB || id === MANUAL_TAB;
const isSideTab = (id: string) =>
  isSideOnly(id) || conceptOfTab(id) !== undefined;

/** The tab that is open: a side tab while what it shows is there, else the chosen document. */
function selectTab(input: {
  side: string | null;
  draftShown: boolean;
  conceptShown: boolean;
  liveApp: boolean;
  manual: boolean;
  selectedId: string | null;
  designPart: DesignPart;
}): string | null {
  const { side } = input;
  if (side === DRAFT_TAB && input.draftShown) return DRAFT_TAB;
  if (input.conceptShown) return side;
  if (side === LIVE_TAB && input.liveApp) return LIVE_TAB;
  if (side === MANUAL_TAB && input.manual) return MANUAL_TAB;
  if (input.selectedId === "design" && input.designPart === "mockup")
    return MOCKUP_TAB;
  return input.selectedId;
}

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
    draft: boolean;
    concepts: readonly string[];
    documents: readonly PaneDocument[];
  },
): string | null {
  if (id === null) return null;
  if (id === LIVE_TAB) return have.liveApp ? id : null;
  if (id === MANUAL_TAB) return have.manual ? id : null;
  if (id === DRAFT_TAB) return have.draft ? id : null;
  const concept = conceptOfTab(id);
  if (concept !== undefined) return have.concepts.includes(concept) ? id : null;
  const document = id === MOCKUP_TAB ? "design" : id;
  return have.documents.some((item) => item.id === document) ? id : null;
}
const liveIds = panelTabIds(TAB_PREFIX, LIVE_TAB);
// A pane whose page fills it edge to edge: the app, a mockup, a spreadsheet or the design draft.
const FILL_PANE = styles.fill;

/** The app's manual as a written page: no versions to pick, its pictures where it places them. */
function manualPage(
  project: string,
  manual: UserManual,
): WrittenDocumentViewProps {
  return {
    project,
    title: wording.documentTab["user_manual"] ?? "",
    meta: wording.documentViewer.asBuilt,
    groups: [],
    body: {
      kind: "text",
      source: splitLeadingHeading(manual.markdown).body,
      images: new Map(Object.entries(manual.pictures)),
    },
  };
}

// Each document's panes: one per document, two for the design.
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

/** The parts of the pane that read the hub for themselves, which whoever draws the pane fills. */
export type ArtifactPaneSlots = DeliverableSlots & {
  /** Once there is an app, filed or being built, or a build plan for one, a tab for it. */
  liveApp?: ReactElement | null;
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
  /** The tab the room asks for, from the conversation or the sidebar; a new object asks again. */
  openTab?: { value: string } | null;
  /** A written document the room asks to print; it prints once the pane has read it. */
  printTab?: { value: string } | null;
  /** Hears which tab the pane shows, so the room can mark it. */
  onShownChange?: (tab: string | null) => void;
  /** The filed documents, a pane each. */
  documents: readonly PaneDocument[];
  /** The document the pane reads, by its id. */
  selectedId: string | null;
  /** How the read of that document stands. */
  state: DeliverableState | undefined;
  onSelect: (id: string) => void;
  /** The person has the document open, so its current version is no longer unread. */
  onSeen: (id: string) => void;
  onRetry?: (() => void) | undefined;
  onReadVersion?: (version: number) => Promise<ReadVersion>;
  onAddToPrompt?: (passage: PassageQuote) => void;
  onDeliverMessage?: ((message: string) => Promise<boolean | void>) | undefined;
  /** The person's pick of a filed approach, and how to make it; choosing is absent on an archived project. */
  approachChoice?: ApproachChoice;
  /** Approves a document at the version read, by its tab; absent on an archived project. */
  onApprove?: ((id: string, version: number) => Promise<void>) | undefined;
  plugins?: readonly PluginTab[] | undefined;
};

export type ArtifactPaneProps = ArtifactPaneContent &
  ArtifactPaneSlots & {
    /** The pane itself, for whoever moves focus to it. */
    paneRef?: Ref<HTMLElement>;
    /** The pane is in view; a closed one waits hidden, so nothing in it is being read. */
    open: boolean;
  };

/**
 * The project view: one pane per file the project sidebar lists, the chosen one shown. Panes stay
 * mounted so a later editor can keep its place.
 */
export function ArtifactPane({
  projectId,
  projectTitle,
  draft = null,
  manual = null,
  concepts,
  openTab = null,
  printTab = null,
  onShownChange,
  liveApp = null,
  conceptMockup,
  documents,
  selectedId,
  state,
  onSelect,
  onSeen,
  paneRef,
  open,
  onRetry,
  onReadVersion,
  onAddToPrompt,
  onDeliverMessage,
  approachChoice,
  onApprove,
  approvalRounds,
  tweakPanel,
  plugins = [],
  writtenDocument,
}: ArtifactPaneProps) {
  // A tab that is not a filed document: the design draft or the live app.
  const [side, setSide] = useState<string | null>(null);
  const [pluginTab, setPluginTab] = useState<string | null>(null);
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
    if (plugins.some((tab) => tab.value === id)) return setPluginTab(id);
    setPluginTab(null);
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
  useEffect(() => {
    if (openTab !== null) choose(openTab.value);
  }, [openTab]);
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
  const openId = plugins.some((tab) => tab.value === pluginTab)
    ? pluginTab
    : tabId;
  // The document on show: none while a tab that is not a filed document is open.
  const shown =
    (tabId !== null && isSideOnly(tabId)) || conceptShown || openId !== tabId
      ? undefined
      : documents.find((item) => item.id === selectedId);
  useEffect(() => {
    onShownChange?.(openId);
  }, [openId]);
  // A print the room asked for waits until the document it names is read on the pane.
  const [toPrint, setToPrint] = useState<string | null>(null);
  useEffect(() => {
    if (printTab === null) return;
    choose(printTab.value);
    setToPrint(printTab.value);
  }, [printTab]);
  useEffect(() => {
    if (toPrint === null || shown?.id !== toPrint) return;
    if (state?.status === "loading") return;
    setToPrint(null);
    if (state?.status === "ready") print(toPrint);
  }, [toPrint, shown?.id, state?.status]);
  const print = (value: string) => {
    const item = documents.find((entry) => entry.id === value);
    const pane = document.getElementById(panelTabIds(TAB_PREFIX, value).pane);
    if (item !== undefined && pane !== null)
      printDocument(pane, item.title, item.status);
  };
  const outputs = documents.length > 0 || draftShown || concepts.length > 0;
  useEffect(() => {
    if (open && shown?.unread) onSeen(shown.id);
  }, [open, shown?.id, shown?.unread]);
  return (
    <Panel
      ref={paneRef}
      className={styles.pane}
      data-slot="artifact-pane"
      aria-label="Documents"
    >
      {!outputs && openId === null ? (
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
          value={openId ?? NO_TAB}
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
                    writtenDocument={writtenDocument}
                  />
                </PanelPane>
              );
            }),
          )}
          {liveApp !== null ? (
            <PanelPane value={LIVE_TAB} className={FILL_PANE} id={liveIds.pane}>
              {liveApp}
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
              className={FILL_PANE}
              id={manualIds.pane}
            >
              <WrittenDocumentView {...manualPage(projectTitle, manual)} />
            </PanelPane>
          ) : null}
          {draftShown ? (
            <PanelPane
              value={DRAFT_TAB}
              className={FILL_PANE}
              id={draftIds.pane}
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
          {plugins.map((tab) => {
            const ids = panelTabIds(TAB_PREFIX, tab.value);
            return (
              <PanelPane key={tab.value} value={tab.value} id={ids.pane}>
                {tab.pane}
              </PanelPane>
            );
          })}
        </PanelContent>
      )}
    </Panel>
  );
}
