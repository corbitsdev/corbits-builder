/**
 * The project room as it looks: the conversation with the coordinator across the page, the dock
 * beneath it (the composer, or a banner saying why there is none), the project view that opens
 * over it from a card or the sidebar and closes back to the conversation, and the plugin
 * space beside them both, where every plugin screen opens.
 */
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { X } from "lucide-react";
import { Button as UiButton, ConversationEmptyState } from "@corbits/react-ui";
import type { ScreenStatus } from "@corbits-builder/plugin";
import { wording } from "../../config.ts";
import { useShellReply } from "../../flourish.tsx";
import {
  ArtifactPane,
  type ArtifactPaneContent,
  type ArtifactPaneSlots,
} from "./artifact-pane.tsx";
import { InBox, useBoxPorts } from "./box-ports.tsx";
import { PluginSpace } from "./plugin-space.tsx";
import {
  choiceOnGone,
  choiceOnTab,
  coverOf,
  NO_CHOICE,
  type SpaceChoice,
} from "./overlay.ts";
import {
  ProjectSidebarView,
  type ProjectSidebarViewProps,
} from "./project-sidebar.view.tsx";
import {
  decides,
  RoomDockView,
  waitingCard,
  type BoxWaiting,
  type RoomDock,
} from "./prompt-box.view.tsx";
import { RoomFrame } from "./room-frame.tsx";
import { SketchingShown } from "./sketching.tsx";
import { StageView } from "./stage-view.tsx";
import { RoomThread, type RoomThreadContent } from "./transcript.tsx";
import styles from "./index.module.css";

/** The parts of the room that read the hub for themselves, which the page fills. */
export type RoomSlots = {
  /** The reading pane's own such parts. */
  paneParts: ArtifactPaneSlots;
  /**
   * The plugin screen waiting first, drawn where its plugin says: in the plugin space, or inside
   * the box's card; null while none does.
   */
  pluginSpace: ReactNode;
  /**
   * The conversation for the chat sheet that pulls up around the prompt box over the project view
   * or a page. The room's own conversation already shows the thread, so over it the box has none.
   * Absent, no box has a handle.
   */
  chat?: ReactNode;
  /** The project's own menu, opened from its name in the sidebar; absent, the name is just shown. */
  projectMenu?: ProjectSidebarViewProps["menu"];
};

/** What the room shows and what the person can do in it. */
export type RoomContent = {
  /** The project's name. */
  title: string;
  layout: {
    /** Something is filed, drafted or running, so the project view has something to show. */
    projectReady: boolean;
    /** The project view covers the room, with the prompt box beneath it; closed, it waits hidden. */
    projectOpen: boolean;
    /** What a written page lies on: grey, raised as a sheet, or plain white. */
    documentGround: "grey" | "white";
    /** The page open is the document the person opened from what waits in the box. */
    waitedOnShown: boolean;
    onCloseProject: () => void;
  };
  conversation: {
    thread: RoomThreadContent;
    /** What stands in the thread's place: an archived project's note, or a new project's welcome. */
    empty: "archived" | "new" | null;
  };
  dock: RoomDock;
  /** The project's sidebar: its plan, its app and the ways out of the room. */
  sidebar: ProjectSidebarViewProps;
  /** What the prompt box holds for the person to deal with; null while nothing waits. */
  waiting: BoxWaiting | null;
  /**
   * The plugin screen waiting first, by this name, and where its plugin draws it: a screen for the
   * page opens in the plugin space, any other inside the box's card. Null while none does, and
   * then there is no space. Its key changes when another screen takes its place. It may show more
   * of what a project view tab shows, such as a mockup to review; null when it shows none.
   */
  space: {
    key: string;
    title: string;
    place: "page" | "box";
    shows: string | null;
  } | null;
  documentPane: ArtifactPaneContent;
  /** Where each plugin tab that says so stands, beside the plan, each opening its tab. */
  tabStatus: readonly TabStatus[];
  /** The project view's pane, which takes focus as it opens. */
  paneRef: RefObject<HTMLElement | null>;
};

export type TabStatus = ScreenStatus & { tab: string; onOpen: () => void };

export type RoomViewProps = RoomContent & RoomSlots;

export function RoomView({
  title,
  layout,
  conversation,
  dock,
  sidebar,
  waiting,
  space,
  documentPane,
  tabStatus,
  paneRef,
  paneParts,
  pluginSpace,
  chat,
  projectMenu,
}: RoomViewProps) {
  const {
    projectReady,
    projectOpen,
    documentGround,
    waitedOnShown,
    onCloseProject: closeProject,
  } = layout;
  const conversationRef = useRef<HTMLElement>(null);
  const shell = useShellReply(conversationRef);
  const mainRef = useRef<HTMLDivElement>(null);
  // The box floats over the foot of the project view and of a screen over the conversation, so
  // each keeps what it must reach clear of it by the box's height, which grows as the person writes.
  const dockRef = useRef<HTMLDivElement>(null);
  // Set before paint, so the page's first frame already keeps clear of the box.
  useLayoutEffect(() => {
    const main = mainRef.current;
    const box = dockRef.current;
    if (main === null || box === null) return;
    // The pill or handle standing above the box, which a view that fills the pane ends above too,
    // so nothing of it shows beneath them.
    let grip: HTMLElement | null = null;
    // The box at rest: while the chat is pulled up over the view, the view keeps the foot it had.
    const measure = () => {
      if (
        box.querySelector('[data-slot="chat-sheet"]:not([data-state="closed"])')
      )
        return;
      main.style.setProperty("--box-height", `${String(box.offsetHeight)}px`);
      const top = box.getBoundingClientRect().top;
      const reach =
        grip === null ? 0 : Math.max(0, top - grip.getBoundingClientRect().top);
      main.style.setProperty(
        "--dock-height",
        `${String(Math.ceil(box.offsetHeight + reach))}px`,
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    // The grip comes and goes, and the sheet opens and closes, without the box resizing, so those
    // changes look for the grip again and measure.
    const follow = () => {
      const found = box.querySelector<HTMLElement>('[data-slot="chat-grip"]');
      if (found !== grip) {
        if (grip !== null) observer.unobserve(grip);
        if (found !== null) observer.observe(found);
        grip = found;
      }
      measure();
    };
    follow();
    // Words streaming into the chat's history move neither the grip nor the box, so those changes
    // measure nothing.
    const changes = new MutationObserver((records) => {
      if (records.every((record) => inHistory(record.target))) return;
      follow();
    });
    changes.observe(box, {
      childList: true,
      subtree: true,
      attributeFilter: ["data-state"],
    });
    return () => {
      observer.disconnect();
      changes.disconnect();
    };
  }, []);
  // Only a screen its plugin draws for the page has a space; any other is in the box. Over the
  // conversation it takes the whole page, the box beneath it, since a mockup or a set of designs
  // needs the width. Over the project view it waits for Open in the box. Answering it puts it away;
  // so does closing it, which leaves it waiting in the box to open again.
  const side = space?.place === "page" ? space : null;
  const [choice, setChoice] = useState<SpaceChoice>(NO_CHOICE);
  const [paneShown, setPaneShown] = useState<string | null>(null);
  // Pulled up over a view, the chat puts itself back on Escape before the view closes.
  const [chatUp, setChatUp] = useState(false);
  const cover = coverOf({ projectOpen, space: side, choice, paneShown });
  const opening = (tab: string) => {
    if (side !== null) setChoice((current) => choiceOnTab(current, side, tab));
  };
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inputRef = dock.kind === "composer" ? dock.inputRef : null;
  const openSpace = () => {
    if (choice.kind !== "opened") setChoice({ kind: "opened" });
    else headingRef.current?.focus();
  };
  // Closing takes away the control that had the cursor, so it goes back to the box.
  const refocusBox = useRef(false);
  // Closed over the tab it stands in for, it goes back to the conversation, as it does from there.
  const closeSheet = () => {
    if (side !== null) setChoice({ kind: "closed", key: side.key });
    if (cover.kind === "space" && cover.over === "tab") closeProject();
    refocusBox.current = true;
  };
  // A space the person opened from the box takes focus to its heading; one that comes of its own
  // accord leaves the cursor where it is.
  const opened = choice.kind === "opened";
  useEffect(() => {
    if (opened) headingRef.current?.focus();
  }, [opened]);
  // Once a screen is submitted the next takes its place, or the space closes; either way the
  // person carries on in the prompt box, with what they had typed still there.
  const spaceKey = space?.key ?? null;
  const shownKey = useRef(spaceKey);
  useEffect(() => {
    const before = shownKey.current;
    shownKey.current = spaceKey;
    if (before === null || before === spaceKey) return;
    if (spaceKey === null) setChoice(choiceOnGone);
    const active = document.activeElement;
    const lost =
      active === null ||
      active === document.body ||
      (active instanceof HTMLElement &&
        active.closest('[data-slot="plugin-space"]') !== null);
    if (lost) refocusBox.current = true;
  }, [spaceKey]);
  useEffect(() => {
    if (!refocusBox.current) return;
    refocusBox.current = false;
    inputRef?.current?.focus();
  });
  // Focus goes into the project view as it opens and back to what opened it as it closes.
  useEffect(() => {
    if (!projectOpen) return;
    const opener = document.activeElement;
    paneRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [projectOpen]);
  // Escape puts away what covers the conversation, the space before the view. A menu inside the
  // view closes on Escape first and marks the key as used; a chat pulled up puts itself back first.
  const putAway = useEffectEvent(() => {
    if (chatUp) return;
    if (cover.kind === "space") closeSheet();
    else closeProject();
  });
  const covered = cover.kind !== "chat";
  useEffect(() => {
    if (!covered) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      putAway();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [covered]);
  // How many sketches at work are on the project's page.
  const [sketches, setSketches] = useState(0);
  const showSketch = useCallback(() => {
    setSketches((count) => count + 1);
    return () => setSketches((count) => count - 1);
  }, []);
  const projectShown = cover.kind === "project";
  const sheetShown = cover.kind === "space";
  // A screen in the plugin space reaches the box: its forward action, placeholder and Send.
  const ports = useBoxPorts();
  const card = waitingCard(
    waiting,
    sheetShown ? undefined : openSpace,
    space?.place === "box" ? pluginSpace : null,
  );
  // Over the document it asks the person to accept, the card folds to its title above the typing
  // row and action, since the rest would repeat the page. Over a mockup or another document the
  // person would see Approve without knowing what it approves, so the card shows. A screen open over
  // the page already shows the question, so the card folds to the typing row alone then.
  const askOverPage =
    projectShown && waitedOnShown && decides(waiting) ? waiting.title : null;
  const decidesPage =
    askOverPage !== null || (sheetShown && waiting?.kind === "screen");
  // Covered, the conversation is out of sight, so the box has the chat to pull up and its pill says
  // what is running. Full screen is the room's own conversation: what the chat was pulled up over
  // is put away.
  const fullScreen = () => {
    if (sheetShown) closeSheet();
    closeProject();
  };
  // The screen the box lists is the one that hands its action to the box; any other keeps its own.
  const spaceScreen =
    side === null ? null : (
      <InBox ports={ports} as={waiting?.kind === "screen" ? "space" : null}>
        {pluginSpace}
      </InBox>
    );
  return (
    <StageView aria-label={`Conversation for ${title}`}>
      <RoomFrame
        sidebar={
          <ProjectSidebarView
            {...openingFrom(sidebar, opening)}
            menu={projectMenu}
          />
        }
      >
        <div ref={mainRef} className={styles.main} data-slot="room-main">
          <section
            ref={conversationRef}
            className={styles.conversationPane}
            aria-label="Project conversation"
          >
            <div className={styles.conversation}>
              <div className={styles.top}>
                {projectReady && !projectOpen ? (
                  <TabStatusControls
                    tabStatus={tabStatus}
                    className={styles.controls}
                  />
                ) : null}
              </div>
              <RoomThread {...conversation.thread}>
                <EmptyConversation empty={conversation.empty} />
              </RoomThread>
            </div>
          </section>
          {projectReady ? (
            // Kept while closed, so its panes, previews and drafts keep their place.
            <div
              className={styles.page}
              data-slot="room-project"
              data-ground={documentGround}
              hidden={!projectOpen}
            >
              <BackToChat onClose={closeProject} />
              {/* Open, the view covers the chat's corner, so the tabs' status moves next to its close button. */}
              {projectOpen ? (
                <TabStatusControls
                  tabStatus={tabStatus}
                  className={styles.pageControls}
                />
              ) : null}
              <SketchingShown value={showSketch}>
                <ArtifactPane
                  {...documentPane}
                  onShownChange={(tab) => {
                    setPaneShown(tab);
                    documentPane.onShownChange?.(tab);
                  }}
                  {...paneParts}
                  paneRef={paneRef}
                  open={projectOpen}
                />
              </SketchingShown>
            </div>
          ) : null}
          {sheetShown && side !== null ? (
            <div className={styles.page} data-slot="room-space-sheet">
              <BackToChat onClose={closeSheet} />
              <PluginSpace title={side.title} headingRef={headingRef}>
                {spaceScreen}
              </PluginSpace>
            </div>
          ) : null}
          {/* One box over the conversation and whatever covers it, so opening or closing a view
              never moves it or starts it over. */}
          <div ref={dockRef} className={styles.dock} data-slot="room-dock">
            <RoomDockView
              dock={projectShown && sketches > 0 ? sketchingDock(dock) : dock}
              ports={ports}
              waiting={card}
              cardHidden={decidesPage}
              cardAsk={askOverPage}
              chat={covered ? chat : undefined}
              chatStart={
                covered
                  ? {
                      saysWork: true,
                      onFullScreen: fullScreen,
                      onUpChange: setChatUp,
                    }
                  : { onUpChange: setChatUp }
              }
              answersShell={shell.answers}
            />
          </div>
        </div>
      </RoomFrame>
      {shell.reply}
    </StageView>
  );
}

function EmptyConversation({ empty }: { empty: "archived" | "new" | null }) {
  if (empty === "archived")
    return (
      <ConversationEmptyState
        title={wording.archivedProject.conversationTitle}
        description={wording.archivedProject.conversationLead}
      />
    );
  if (empty === "new")
    return (
      <ConversationEmptyState
        title={wording.conversation.empty}
        description={wording.conversation.emptyLead}
      />
    );
  return null;
}

/**
 * A sketch at work on the page already says work is under way, so the box over it does not say it
 * again; a status with something to press, such as Try again, still shows.
 */
function sketchingDock(dock: RoomDock): RoomDock {
  return dock.kind === "composer" && dock.status?.onAction === undefined
    ? { ...dock, status: null }
    : dock;
}

/** Shuts the view over the conversation like a full-screen modal, in the corner people look for. */
function BackToChat({ onClose }: { onClose: () => void }) {
  return (
    <UiButton
      type="button"
      size="icon"
      variant="ghost"
      className={styles.close}
      aria-label={wording.conversation.backToChat}
      title={wording.conversation.backToChatHint}
      onClick={onClose}
    >
      <X size={18} aria-hidden="true" />
    </UiButton>
  );
}

/** Each plugin tab's status, as a button that opens the tab. */
function TabStatusControls({
  tabStatus,
  className,
}: {
  tabStatus: readonly TabStatus[];
  className: string | undefined;
}) {
  if (tabStatus.length === 0) return null;
  return (
    <div className={className}>
      {tabStatus.map(({ tab, label, mark, onOpen }) => (
        <UiButton
          key={tab}
          type="button"
          size="sm"
          variant="outline"
          className={styles.control}
          data-mark={mark}
          aria-label={wording.conversation.tabStatus(tab, label)}
          title={wording.conversation.openTab(tab)}
          onClick={() => onOpen()}
        >
          {label}
        </UiButton>
      ))}
    </div>
  );
}

/** The sidebar, telling the room which tab each of its steps, files and rows opens before it opens it. */
function openingFrom(
  sidebar: ProjectSidebarViewProps,
  opening: (tab: string) => void,
): ProjectSidebarViewProps {
  const { files, plan, sections } = sidebar;
  return {
    ...sidebar,
    sections:
      sections === undefined
        ? undefined
        : {
            ...sections,
            onOpen: (tab) => {
              opening(tab);
              sections.onOpen(tab);
            },
          },
    plan: {
      ...plan,
      onOpenStep: (id, tab) => {
        opening(tab);
        plan.onOpenStep(id, tab);
      },
    },
    files:
      files === undefined
        ? undefined
        : {
            ...files,
            onOpen: (tab) => {
              opening(tab);
              files.onOpen(tab);
            },
          },
  };
}

const inHistory = (node: Node) =>
  node instanceof Element &&
  node.closest('[data-slot="chat-history"]') !== null;
