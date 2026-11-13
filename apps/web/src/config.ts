/**
 * The product name and every piece of wording the interface reuses, so a
 * rename is one edit here. The interface cannot read the hub's product config:
 * its only route for it is tenant-scoped, and the sign-in screens and the page
 * title render before any authenticated request.
 */
export const productName = "Builder";

/**
 * The lead of the opening message the hub sends a newly imported project's
 * coordinator on the person's behalf. It mirrors IMPORTED_PROJECT_LEAD in
 * apps/hub/src/config/import.ts, whose message appends the filed materials and
 * any built app; the thread shows it as a divider.
 */
export const IMPORTED_PROJECT_LEAD =
  "I just imported this project from a file. Acknowledge the import, then tell me in a few plain sentences what the imported documents establish and what happens next.";

/**
 * The lead of every note the hub mails the coordinator as the person. It mirrors HUB_NOTE_LEAD in
 * apps/hub/src/config/resume.ts; the thread shows the note's first paragraph as a quiet line and
 * keeps the rest, which is for the coordinator.
 */
export const HUB_NOTE_LEAD = "Hub note, not from the person: ";

const megabytes = (bytes: number) =>
  `${String(Math.floor(bytes / 1_048_576))} MB`;

/** A step's row while it works and once done, given what it touches when the call names it. */
type StepPhrase = {
  readonly working: (subject?: string) => string;
  readonly done: (subject?: string) => string;
};

const fixed = (working: string, done: string): StepPhrase => ({
  working: () => working,
  done: () => done,
});

// "Reading src/app.ts", else "Reading a file" when the call names nothing.
const naming = (
  verbs: readonly [string, string],
  alone: readonly [string, string],
): StepPhrase => ({
  working: (subject) =>
    subject === undefined ? alone[0] : `${verbs[0]} ${subject}`,
  done: (subject) =>
    subject === undefined ? alone[1] : `${verbs[1]} ${subject}`,
});

// The coordinator's runs and plan calls, by operation; a call still streaming names none yet.
const RUNS_OPERATION: Record<string, StepPhrase> = {
  list: fixed(
    "Checking on the work in progress",
    "Checked on the work in progress",
  ),
  wait: fixed(
    "Waiting for the work to finish",
    "Waited for the work to finish",
  ),
  stop: fixed("Stopping the work", "Stopped the work"),
};
const PLAN_OPERATION: Record<string, StepPhrase> = {
  show: fixed("Looking at the plan", "Looked at the plan"),
  set: fixed("Updating the plan", "Updated the plan"),
  add: fixed("Updating the plan", "Updated the plan"),
  remove: fixed("Updating the plan", "Updated the plan"),
};
const byOperation = (
  operations: Record<string, StepPhrase>,
  other: StepPhrase,
): StepPhrase => ({
  working: (operation) => (operations[operation ?? ""] ?? other).working(),
  done: (operation) => (operations[operation ?? ""] ?? other).done(),
});

// Every tool a specialist or the coordinator can call. A file tool's subject is its path, a
// document's its kind in words, an install's its packages and report_values' the names it saves.
const STEPS: Record<string, StepPhrase> = {
  read_file: naming(["Reading", "Read"], ["Reading a file", "Read a file"]),
  write_file: naming(["Writing", "Wrote"], ["Writing a file", "Wrote a file"]),
  edit_file: naming(["Editing", "Edited"], ["Editing a file", "Edited a file"]),
  search_files: naming(
    ["Looking for files matching", "Looked for files matching"],
    ["Looking through the files", "Looked through the files"],
  ),
  grep: {
    working: (subject) =>
      subject === undefined
        ? "Searching the code"
        : `Searching the code for “${subject}”`,
    done: (subject) =>
      subject === undefined
        ? "Searched the code"
        : `Searched the code for “${subject}”`,
  },
  run_shell: naming(["Running", "Ran"], ["Running a command", "Ran a command"]),
  app_status: {
    working: (command) =>
      command === undefined ? "Checking the app" : "Starting the app",
    done: (command) =>
      command === undefined ? "Checked the app" : "Started the app",
  },
  install_packages: naming(
    ["Installing", "Installed"],
    ["Installing packages", "Installed packages"],
  ),
  run_done_checks: fixed("Running the final checks", "Ran the final checks"),
  check_design: fixed("Checking the design", "Checked the design"),
  file_design_option: fixed(
    "Filing the design option",
    "Filed the design option",
  ),
  read_skill: {
    working: (guide) =>
      guide === undefined
        ? "Studying a guide"
        : `Studying the ${guide.replaceAll("-", " ")} guide`,
    done: (guide) =>
      guide === undefined
        ? "Studied a guide"
        : `Studied the ${guide.replaceAll("-", " ")} guide`,
  },
  read_artifact: naming(
    ["Reading the", "Read the"],
    ["Checking the project's documents", "Checked the project's documents"],
  ),
  write_artifact: naming(
    ["Filing the", "Filed the"],
    ["Filing a document", "Filed a document"],
  ),
  report_values: naming(
    ["Saving the", "Saved the"],
    ["Saving what it learned", "Saved what it learned"],
  ),
  write_deck: fixed("Building the slide deck", "Built the slide deck"),
  check_deck: fixed("Checking the slide deck", "Checked the slide deck"),
  file_package: fixed(
    "Filing the approval package",
    "Filed the approval package",
  ),
  mail_send: fixed("Sending a note", "Sent a note"),
  mail_reply: fixed("Replying", "Replied"),
  mail_read: fixed("Reading a note", "Read a note"),
  mail_search: fixed("Reading notes", "Read notes"),
  mail_wait: fixed("Waiting for a reply", "Got a reply"),
  exec: fixed("Rewriting a step", "Rewrote a step"),
  discover: fixed("Choosing how to do this", "Chose how to do this"),
  execute: fixed("Handing work to a specialist", "Handed work to a specialist"),
  question: fixed("Asking you a question", "Asked you a question"),
  runs: byOperation(
    RUNS_OPERATION,
    fixed(
      "Checking on the work in progress",
      "Checked on the work in progress",
    ),
  ),
  plan: byOperation(
    PLAN_OPERATION,
    fixed("Working on the plan", "Worked on the plan"),
  ),
};

// The coder's browser, which only reaches its own running app.
const BROWSER_STEPS: Record<string, StepPhrase> = {
  navigate: fixed("Opening the app's page", "Opened the app's page"),
  navigate_back: fixed("Going back a page", "Went back a page"),
  tabs: fixed("Switching tabs", "Switched tabs"),
  close: fixed("Closing the browser", "Closed the browser"),
  snapshot: fixed("Looking at the page", "Looked at the page"),
  find: fixed(
    "Looking for something on the page",
    "Looked for something on the page",
  ),
  click: fixed("Clicking on the page", "Clicked on the page"),
  type: fixed("Typing into the page", "Typed into the page"),
  fill_form: fixed("Filling in a form", "Filled in a form"),
  select_option: fixed("Picking an option", "Picked an option"),
  press_key: fixed("Pressing a key", "Pressed a key"),
  hover: fixed("Pointing at the page", "Pointed at the page"),
  drag: fixed("Dragging on the page", "Dragged on the page"),
  handle_dialog: fixed("Answering a pop-up", "Answered a pop-up"),
  evaluate: fixed("Running a script on the page", "Ran a script on the page"),
  emulate_media: fixed(
    "Trying the page in another display mode",
    "Tried the page in another display mode",
  ),
  wait_for: fixed("Waiting for the page", "Waited for the page"),
  resize: fixed("Resizing the window", "Resized the window"),
  console_messages: fixed(
    "Reading the page's console",
    "Read the page's console",
  ),
  network_requests: fixed(
    "Checking the page's requests",
    "Checked the page's requests",
  ),
  network_request: fixed("Looking at a request", "Looked at a request"),
  take_screenshot: fixed("Taking a screenshot", "Took a screenshot"),
  run_code_unsafe: fixed(
    "Running code in the browser",
    "Ran code in the browser",
  ),
  file_upload: fixed("Uploading a file", "Uploaded a file"),
  drop: fixed("Dropping a file onto the page", "Dropped a file onto the page"),
};

export const wording = {
  builtBy: { label: "Built by Corbits.dev", href: "https://corbits.dev" },
  flourish: {
    fine: "My UX is FINE.",
    madeWithCare: "Made with care by the OSS Builders at corbits.dev",
    forgedBy: "Forged by Sawyer Cutler",
    shellRequest: "sudo make me a sandwich",
    shellAnswer: "Okay.",
    consoleNote:
      "Builder's source: https://github.com/corbitsdev/corbits-builder",
  },
  auth: {
    signUpHeading: "Create your account",
    signInHeading: "Welcome back",
    haveAccount: "Already have an account?",
    noAccount: "No account yet?",
    createAccount: "Create an account",
    passwordTooShort: (min: number) =>
      `Use at least ${String(min)} characters for the password.`,
    hubUnreachable: "The hub is unreachable.",
    signIn: {
      failed: "Could not sign in.",
      noUser: "The hub accepted the sign in but did not return a user.",
    },
    signUp: {
      failed: "Could not create the account.",
      noUser:
        "The hub accepted the request to create the account but did not return a user.",
    },
    signOutFailed: "Could not sign out.",
    noWorkspace: "You are not a member of any workspace yet.",
    accountUnreadable: "Your account could not be read.",
  },
  hub: {
    notAnswering: "The hub is not answering",
  },
  boot: {
    starting: "Starting…",
    slow: "Still starting. This takes longer the first time.",
  },
  /** While the hub cannot be reached: the app waits on its loading screen and retries. */
  loading: `${productName} is loading…`,
  action: {
    archive: "Archive",
    cancel: "Cancel",
    skipForNow: "Skip for now",
    retry: "Try again",
    save: "Save",
    saving: "Saving…",
    signIn: "Sign in",
    signOut: "Sign out",
    tryAgain: "Try again",
    openSettings: "Open Settings",
    enableAi: "Enable AI",
    unarchive: "Restore",
    markShipped: "Mark as shipped",
    reopen: "Reopen",
  },
  status: {
    active: "Active",
    archived: "Archived",
    shipped: "Shipped",
    delivered: "Delivered",
    working: "Working",
  },
  /** Tab labels by document kind; the document's own title is the tab's tooltip and heading. */
  documentTab: {
    problem_brief: "Brief",
    constraints: "Constraints",
    approaches: "Approaches",
    product_requirements: "Requirements",
    build_plan: "Build plan",
    design: "Design plan",
    approval_package: "Approval",
    app: "App",
    user_manual: "User manual",
  } as Record<string, string>,
  documentUnread: "new version",
  documentRetryFailed: "The project could not be read. Try again.",
  tips: {
    label: "Tips",
    setting: "Show tips",
    settingHint: "A tips button sits in the bar at the foot of each document.",
    turnOff: "Turn off tips",
    items: [
      "Select any text to quote it in your message",
      "Click a passage to add it to your prompt",
      "Ask for changes in plain words",
      "Compare versions with the version menu",
    ],
  },
  liveApp: {
    tab: "Live preview",
    title: "What the coder is building, as it runs",
    manualTitle: "How to use it, with pictures of it as built",
    frameTitle: "The running preview",
    notBuiltTitle: "Anything that runs appears here",
    notBuilt: "When the coder builds something you can run, it shows here.",
    setup: {
      working: "The coder is setting this up…",
      note: "It shows here as soon as the coder's first changes run.",
      elapsed: (clock: string) => `${clock} elapsed`,
      checking: "Checking on the coder…",
      unknown:
        "The coder's progress cannot be read right now; it shows here once it can.",
      notWritten: "The coder has not written any files yet.",
      /** The build so far: "12 files written · last: routines · 20 s ago". */
      progress: (files: number, last: string | undefined, ago: string) =>
        `${String(files)} ${files === 1 ? "file" : "files"} written` +
        (last === undefined ? "" : ` · last: ${last}`) +
        ` · ${ago}`,
      nothingYet: (ago: string) =>
        `No files written yet · last activity ${ago}`,
      justNow: "just now",
      secondsAgo: (seconds: number) => `${String(seconds)} s ago`,
      minutesAgo: (minutes: number) => `${String(minutes)} min ago`,
    },
    phase: {
      installing: "Installing the packages it needs",
      starting: "Starting it",
    },
    filedVersion: (version: number) => `App v${String(version)}`,
    savedWork: (commit: string) => `Latest saved work (${commit.slice(0, 7)})`,
    stopped: "It is stopped.",
    stoppedNote: "Nothing is running it right now.",
    failed: "It could not start.",
    restarts: "It starts again when its files next change.",
    lastOutput: "Its last output",
    unavailableTitle: "No preview here",
    unavailable:
      "This Builder cannot run what the coder makes, so it cannot be shown here.",
    openInNewTab: "Open in a new tab",
    download: "Download the code",
    share: "Share the code",
    demoLogin: (email: string, password: string) =>
      `Demo login: ${email} · ${password}`,
    checklistShow: "Show the acceptance checklist",
    checklistHide: "Hide the acceptance checklist",
    controls: "Preview controls",
    checklistTitle: "Acceptance checklist",
    checklistProgress: (done: number, total: number) =>
      `${String(done)} of ${String(total)} checked so far.`,
    checklistDone: "Checked",
    checklistOpen: "Not checked yet",
  },
  nextStep: {
    action: {
      open_app: "Open the preview",
      reply: "Reply",
      resume_coordinator: "Start the coordinator",
    },
  },
  paneBar: {
    hide: "Hide the controls",
    show: "Show the controls",
  },
  paneFile: {
    downloadDocument: "Download as Markdown",
    shareDocument: "Share as Markdown",
    downloadDesign: "Download the design",
    shareDesign: "Share the design",
    downloadSheet: "Download as CSV",
    shareSheet: "Share as CSV",
    downloaded: (name: string) => `Downloaded ${name}.`,
    shareReady: (name: string) => `${name} is ready to share.`,
    shareNow: "Share now",
  },
  documentStatus: {
    approved: (version: number) => `Approved v${String(version)}`,
    drafted: (version: number) => `Drafted v${String(version)}`,
  },
  /** The document bar's approval of the version being read, with no question asking for it. */
  documentApproval: {
    approve: (version: number) => `Approve v${String(version)}`,
    approveLabel: (version: number) => `Approve version ${String(version)}`,
    approved: (version: number) => `Approved v${String(version)}`,
    approvedLabel: (version: number, at: string | undefined) =>
      at === undefined
        ? `Version ${String(version)} is approved`
        : `Version ${String(version)} was approved on ${new Date(at).toLocaleString()}`,
    failed: "That approval was not recorded.",
  },
  newProject: {
    title: "What do you want to make today?",
    lead: "Build, write, edit or improve anything. Say what you want and the coordinator takes it from there.",
    starting: "Starting your project…",
    titleRequired: "A project needs a title.",
    createFailed: "The project could not be created.",
  },
  appVersion: {
    current: (version: number) => `Downloaded version ${String(version)}.`,
    saved: "Downloaded the saved code.",
    forbidden:
      "Downloaded the saved code. You can view this project but not save a new version of its code.",
    elsewhere:
      "Downloaded the saved code. The coder's working copy cannot be read from here, so its current code is not in it.",
    failed: (status: number, code: string) =>
      `Saving the coder's current code failed (status ${String(status)}, ${code}), so this is the saved code without it.`,
    refused: (status: number, code: string) =>
      `The hub refused the request: status ${String(status)}, ${code}.`,
    // Refusals a person reads in plain words instead of by status and code.
    refusals: {
      app_repository_unreadable: `${productName} cannot read this project's saved code right now.`,
    } as Record<string, string | undefined>,
    unreadable:
      "The hub's answer could not be read; it may be an older hub that has not been restarted.",
  },
  exportProject: {
    title: "Export the project",
    loading: "Checking what this project has to export…",
    sectionsFailed: (reason: string) =>
      `Only the documents can be offered: ${reason}`,
    sections: {
      planning: "Documents",
      design: "Designs and mockups",
      build: "Code",
    },
    action: "Export",
  },
  importProject: {
    action: "Import project",
    source: `A project ${productName} or the original Solution Builder exported`,
    invalid: `This file is not a project ${productName} or the original Solution Builder exported.`,
    omitted: (kinds: string[]) => `Not carried over: ${kinds.join(", ")}.`,
    folderAction: "Import a folder",
    folderSource:
      "A folder of code, usually a git repository, to make a project from",
    folderTitle: (title: string, folder: string) =>
      `Import ${title} from ${folder}?`,
    folderCode: (files: number, size: string) =>
      `Code: ${files} files, ${size}. It is filed as the project's code, and the coder starts from it.`,
    folderNoCode:
      "No package.json was found, so no code is filed; only the documents found are.",
    folderNothing: "Nothing to import: no code and no documents were found.",
    folderFound: (names: string) => `Found in the folder: ${names}.`,
    folderToWrite: (names: string) =>
      `${productName} writes with you, for your approval: ${names}.`,
    folderLeaveOut: "Leave out:",
    folderReasons: {
      secret: "looks like a secret",
      lockfile: `a lockfile ${productName} does not use`,
    },
    folderImport: "Import",
  },
  shell: {
    back: "Back",
    newProject: "New project",
    projectOptions: (title: string) => `Options for ${title}`,
    projects: "Projects",
    inProgress: "Projects in progress",
    whatsNew: "What's new",
    whatsNewBadge: "New",
    settings: "Settings",
    untitledProject: "Project",
    noProjectTitle: "No project open",
    noProjectLead:
      "Pick a project from the list. Its outputs open from the conversation.",
  },
  whatsNew: {
    title: "What's new",
    sections: "What's new features",
    tabs: {
      slideDecks: "Slide decks",
      approvals: "Approvals",
    },
    features: {
      slideDecks: {
        id: "slide_decks",
        title: "Slide decks",
        experimental: false,
        description:
          "Ask the coordinator to present your project for an audience — such as a CEO, CTO, investor, or client — to generate a tailored 16:9 slide deck (.pptx and .pdf) from the project's work and preview it beside the chat.",
      },
      approvals: {
        id: "experimental_approvals",
        title: "Approvals",
        experimental: true,
        statusNote: "Experimental — off by default",
        actionLabel: "Enable in Settings",
        description:
          "Share approval packages with reviewers, track their decisions, and pull their feedback straight into your prompt with one click.",
      },
    },
  },
  projectLoadFailure: {
    title: "This project could not be opened",
    lead: "Something went wrong while opening it. You can try again, or go back and pick another project.",
    back: "Back to projects",
    details: "Technical details",
    copy: "Copy",
    copied: "Copied",
    notListed:
      "The project is not in this workspace's list, or reading it failed.",
  },
  library: {
    title: "Projects",
    subtitle:
      "Every project in this workspace. Archived ones wait under Archived until restored.",
    filterLabel: "Show projects by status",
    all: "All",
    filter: {
      idea: "Idea",
      building: "Building",
      shipped: "Shipped",
      archived: "Archived",
    },
    lastActivity: (relative: string) => `Active ${relative}`,
    view: {
      label: "Show projects as",
      grid: "Tiles",
      rows: "List",
    },
    loading: "Reading your projects…",
    emptyTitle: "No projects yet",
    emptyLead: "Start one from New project; it shows here from then on.",
    allArchivedTitle: "Every project is archived",
    allArchivedLead: "Restore one from Archived, or start a new project.",
    emptyFilterTitle: (filter: string) => `No ${filter.toLowerCase()} projects`,
    emptyFilterLead: "Pick another filter, or All.",
    failed: "Your projects could not be read.",
    actionFailed: "That change to the project did not go through.",
    nameRequired: "A project needs a name.",
    refused: {
      forbidden: "You can see this project but not change it.",
      project_archived: "This project is archived. Restore it to make changes.",
      project_not_found: "This project is no longer in this workspace.",
    } as Record<string, string | undefined>,
  },
  workspace: {
    menu: (name: string) => `Workspace: ${name}`,
    listLabel: "Workspaces",
    create: "Create workspace…",
    createTitle: "Create a workspace",
    createLead:
      "A workspace keeps its own projects and its own model keys. Nothing from this one carries over.",
    nameLabel: "Name",
    namePlaceholder: "Acme product team",
    createAction: "Create workspace",
    creating: "Creating…",
    createdTitle: (name: string) => `${name} is ready`,
    createdLead:
      "It starts empty. Connect a model next so its coordinator can run, then start its first project.",
    openAction: "Open it and connect a model",
    setupFailed: "The workspace could not be set up.",
    setupIncomplete: "Setup did not finish",
  },
  conversation: {
    label: "Conversation",
    map: "Conversation map",
    /** A map entry for a filed document: "Requirements v1". */
    mapDocument: (name: string, version: number) =>
      `${name} v${String(version)}`,
    /** A map entry with where it ended: "Pick a font · Answered". */
    mapMarked: (label: string, mark: string) => `${label} · ${mark}`,
    /** A map marker's accessible name, saying it jumps there, so it never shares a name with the card's own controls. */
    mapGoTo: (label: string) => `Go to: ${label}`,
    empty: "Nothing in the conversation yet",
    emptyLead:
      "Replies show here, and each saved document opens from where it was saved.",
    startingCoordinator: "Starting the coordinator…",
    enableAiFirst: "Enable AI to start the conversation",
    dropFiles: "Drop files to attach them",
    noCoordinator: "This project has no running coordinator.",
    /** Opens everything the project has, its documents, design and preview, over the conversation. */
    openProject: "Project",
    openProjectHint: "Open the project's documents, design and preview",
    /** Takes the person from the project view back to the conversation. */
    closeProject: "Back to the conversation",
    /** The plan beside the conversation: its heading, the button that shows and hides it, and its parts. */
    plan: {
      title: "Plan",
      show: "Show the plan",
      hide: "Hide the plan",
      resize: "Resize the plan",
      steps: "Plan steps",
      optional: "optional",
      approvalRequired: "needs your approval",
      approvalOffered: "asks for your approval",
      /** A step's switches and button, each named with the step it changes. */
      skip: "Skip",
      goAhead: "Go ahead",
      askFirst: "Ask me first",
      forStep: (control: string, step: string) => `${control}: ${step}`,
      notChanged: "That step could not be changed.",
      /** How far along the plan is, beside its button. */
      progress: (done: number, total: number) =>
        `${String(done)}/${String(total)}`,
      /** The plan button's name: how far along the plan is, and a step that wants a look. */
      progressLabel: (
        done: number,
        total: number,
        alert: "failed" | "needs_you" | null,
      ) =>
        [
          `Plan: ${String(done)} of ${String(total)} steps done`,
          alert === "failed" ? "a step failed" : undefined,
          alert === "needs_you" ? "a step needs you" : undefined,
        ]
          .filter((part) => part !== undefined)
          .join(", "),
    },
  },
  /** The composer's placeholder when no approval is open. An open approval keeps approval.composerPlaceholder. */
  composer: {
    passAlong: (role: string) => `Ask the ${role}…`,
    change: "What needs to change…",
    fix: "What needs fixing…",
    making: "What are you making…",
    reply: "What do you want to say…",
  },
  /** What a person's move is waiting on, as the bell and gate name it. */
  wait: {
    permission: "The coordinator asks permission to continue",
    install: "The coder asks to install packages",
    wantsToRun: (toolName: string | undefined) =>
      `Wants to run: ${toolName ?? "a step"}`,
    wantsToInstall: (packages: readonly string[]) =>
      `Wants to install: ${packages.join(", ")}`,
    question: "The coordinator is waiting on you",
    askedInConversation:
      "The coordinator asked a question in the conversation.",
  },
  speaker: {
    coder: "Coder",
    coordinator: "Coordinator",
    specialist: "Specialist",
    you: "You",
  },
  activity: {
    label: "Who is working",
    notRead: "Who is working could not be read.",
    /** Before the run's first tool call: the hub has seen nothing from it yet. */
    starting: "getting started",
    /** How files and commands read in a status line: plain names, never paths or ids. */
    files: {
      earlierOutput: "earlier results",
      generic: "the project's files",
      checkApp: "a full check of the work",
      command: "a quick check",
      known: {
        "DESIGN.md": "the design notes",
        "README.md": "the read-me",
        "USER-MANUAL.md": "the user manual",
        "ACCEPTANCE.md": "the acceptance checklist",
        "AGENTS.md": "the project guide",
        "package.json": "the package setup",
        "index.html": "the main page",
        "styles.css": "the styles",
        "deck.json": "the slide deck",
        "deck.pptx": "the PowerPoint deck",
        "deck.pdf": "the PDF deck",
      } as Record<string, string>,
    },
    /** Verbs for file work, one picked per file so a line reads like a person at work. */
    fileVerbs: {
      read_file: ["reading", "studying", "looking over", "checking"],
      write_file: ["drafting", "sketching", "shaping", "building", "writing"],
      edit_file: ["polishing", "refining", "tweaking", "reworking"],
    } as Record<string, readonly string[]>,
    thinking: "thinking",
    /** The line while the coordinator works before it has said anything. */
    thinkingNow: "Thinking…",
    /** A step's state at the end of its row. */
    status: {
      pending: "Queued",
      running: "Working",
      "output-available": "Done",
      "approval-requested": "Waiting for you",
      // A call its run was stopped, or failed, before it returned from.
      "output-denied": "Stopped",
    },
    /** A list's header: how many steps it holds, which no one of its rows says. */
    run: (count: number) => (count === 1 ? "1 step" : `${String(count)} steps`),
    /** A run's live line and failure count. */
    trigger: {
      thinking: "Thinking",
      working: "Working",
      failed: (count: number) => `${String(count)} did not finish`,
    },
    /** A step's row by tool name; a tool with none reads as its name in words. */
    step: STEPS,
    /** A browser tool's row, by the name after the browser's own prefix. */
    browserStep: BROWSER_STEPS,
    otherTool: (name: string) =>
      name.replace(/^browser\.browser_/, "").replaceAll(/[_.]/g, " "),
    /** A command that runs the project's own checks, by what it does rather than its name. */
    checks: fixed("Running the project's checks", "Ran the project's checks"),
    /** The word before a command shown as itself: "Ran" `bun test`. */
    ran: (done: boolean) => (done ? "Ran" : "Running"),
    /** An opened step: the command it ran and what that printed, else what came of it in words. */
    command: "Command",
    commandOutput: "Output",
    output: "Result",
    exitCode: (code: number) => `Exit code ${String(code)}`,
    /** What came of a step, in a line, where its raw result means nothing to a person. */
    detail: {
      changedIn: (count: number) => `Changed in ${String(count)} places`,
      lines: (count: number) =>
        count === 1 ? "1 line" : `${String(count)} lines`,
      matchingLines: (count: number) =>
        count === 1 ? "1 matching line" : `${String(count)} matching lines`,
      matchingFiles: (count: number) =>
        count === 1 ? "1 file matched" : `${String(count)} files matched`,
      nothingMatched: "Nothing matched",
      version: (version: number) => `Version ${String(version)}`,
      document: (title: string, version: number) =>
        `${title}, version ${String(version)}`,
      part: (part: number, parts: number) =>
        `part ${String(part)} of ${String(parts)}`,
      documents: (count: number) =>
        count === 1 ? "1 document" : `${String(count)} documents`,
      unchanged: "Nothing changed since the version already filed",
      slides: (count: number) =>
        count === 1 ? "1 slide" : `${String(count)} slides`,
      deckPassed: "The slide deck passed its checks",
      running: (url: string) => `Running at ${url}`,
      notRunning: "Not running",
      checksNotRun: (why: string) => `The checks did not run: ${why}`,
      filed: (version: number) => `Filed as version ${String(version)}`,
      rewritten:
        "The coordinator wrote this step in a form Builder cannot run, so it was asked to write it again.",
    },
    elapsed: (minutes: number, seconds: number) =>
      minutes === 0 ? `${seconds}s` : `${minutes}m`,
  },
  design: {
    mockupTab: "Design mockup",
    noPlan: "This design has no written plan.",
    draftBadge: "Draft",
    draftInProgress:
      "Draft in progress. The designer is still working; this preview refreshes on its own until the design is filed.",
    draftIdle:
      "Draft. The designer is not at work on it right now; this preview refreshes on its own until the design is filed.",
    /** One design concept as the person compares it: "Bold concept". */
    conceptTitle: (label: string) => `${label} concept`,
    /** A concept's tab, numbered in the order its designer started: "Design mockup 1 · Retro". */
    conceptTab: (number: number, label: string) =>
      `Design mockup ${number} · ${label}`,
    conceptSketching: (label: string) =>
      `The designer is sketching your ${label} concept…`,
    conceptSketchingNote:
      "Its mockup shows here once the designer has drafted it.",
    conceptSketchingElapsed: (clock: string) => `${clock} elapsed`,
    conceptWaiting: (label: string) =>
      `The designer of your ${label} concept is between steps.`,
    /** The pane bar's control that shows what a design concept is going for. */
    conceptDirection: "What this design mockup is going for",
  },
  /** The approval package viewer: slides, PDF preview, and pinned source manifest. */
  approvalPackage: {
    label: "Approval package",
    viewLabel: "Approval package view",
    tabs: {
      slides: "Slides",
      pdf: "PDF",
      sources: "Sources",
    },
    slideCount: (index: number, total: number) =>
      `Slide ${String(index)} of ${String(total)}`,
    pageCount: (index: number, total: number) =>
      `Page ${String(index)} of ${String(total)}`,
    loadingSlides: "Loading slides…",
    slidesUnavailable:
      "The slides could not load. Reload the page to try again.",
    downloadPdf: "Download PDF",
    openPdf: "Open PDF",
    pdfTitle: "Approval package PDF preview",
    pdfUnreadable: "The PDF in this package could not be read.",
    manifest: {
      audience: "Audience",
      decisionNeeded: "Decision needed",
      tone: "Tone",
      length: "Length",
      sources: "Pinned source documents",
      sourceKind: "Document",
      sourceTitle: "Title",
      sourceVersion: "Version",
      sourceHash: "SHA-256",
      documents: "Supporting documents",
    },
    unreadable: "This approval package could not be read.",
  },
  /** The approaches document's comparison, above its prose. */
  approaches: {
    label: "Approaches side by side",
    recommended: "Recommended",
    effort: {
      low: "Low effort",
      medium: "Medium effort",
      high: "High effort",
    },
    bestFor: "Best for",
    pros: "Pros",
    cons: "Cons",
    risks: "Risks",
    choose: "Pick this one",
    choosing: "Sending…",
    chosen: "Your choice",
    /** The message the person sends the coordinator when they pick one. */
    message: (name: string) => `I choose the ${name} approach.`,
    notSent: "Your choice was not sent. Try again.",
  },
  /** A specialist that ended before finishing, as the thread's quiet notice. */
  specialistEnded: {
    /** The recorded native failure code in plain words. */
    cause: {
      "crash-mid-invocation": "the server restarted while it was working",
      cancelled: "it was cancelled",
      timeout: "it ran out of time",
      "timed-out": "it ran out of time",
    } as Record<string, string>,
    restart: "The coordinator can start it again.",
    details: "Details",
  },
  /** A coordinator hand-off and what came of it, as one message in the conversation. */
  dispatch: {
    /** A specialist's row: who, and what it does. */
    row: (role: string, doing: string) => `${role} · ${doing}`,
    /** What a specialist of no known role does when no action of its own names it. */
    working: "Working",
    done: "Done",
    /** Where the work stands, at the end of its row. */
    status: {
      pending: "Starting…",
      running: "Working",
      "output-available": "Done",
      error: "Did not finish",
      "approval-requested": "Waiting for you",
      "output-denied": "Not done",
    },
    /** A row whose run is held on the person, with what it asked: "Waiting for you to approve installing zod". */
    waitingFor: (asked: string) => `Waiting for you to approve ${asked}`,
    /** What a held run asked, as `waitingFor` ends: its packages, else its tool. */
    asked: {
      install: (packages: readonly string[]) =>
        `installing ${packages.join(", ")}`,
      tool: (tool: string) => `its use of ${tool}`,
    },
    /** Opens the document the run filed; named in full for a screen reader and on hover. */
    open: "Open",
    openNamed: (document: string, version: number) =>
      `Open ${document} v${String(version)}`,
    /** Opens the project view on what a working specialist is making, as it makes it. */
    watchDraft: "Watch the draft",
    watchApp: "Watch it run",
    /** Names what a working run is writing, shown as it streams in. */
    preview: "What it is writing",
    /** A working run's model is thinking and has written nothing yet. */
    thinkingThrough: "Thinking it through",
    /** A working run with nothing streaming in right now: a tool running, or a model call not yet in. */
    waitingForStep: "Working. Each step shows here as it happens.",
    askedTo: "Asked to",
    /** Shows the rest of a finished specialist's report, and folds it again. */
    more: "More",
    less: "Less",
    failedUnknown: "the run stopped without a reason",
    /** A run the person or the coordinator stopped, at the end of its row. */
    stopped: "Stopped",
    /** A run that hit something it could not get past, at the end of its row; why shows under it. */
    blocked: "Blocked",
    /** Stops a working specialist, asked once in its row before it does. */
    stop: "Stop",
    stopAsk: (role: string) => `Stop the ${role.toLowerCase()}?`,
    keepGoing: "Keep going",
    notStopped: "The run could not be stopped.",
  },
  /** Before a message changes a document a specialist is building from. */
  earlierDocument: {
    warning: (specialist: string) =>
      `The ${specialist} is already working from this. Changing it now may cost more and restart some of their work.`,
    sendAnyway: "Send anyway",
  },
  /** Files the person attaches to a message, filed as materials the coordinator reads. */
  attach: {
    add: "Attach files",
    tooMany: (max: number) =>
      `You can attach up to ${String(max)} files at a time.`,
    tooLarge: (name: string, bytes: number) =>
      `${name} is too large. Each file can be up to ${megabytes(bytes)}.`,
    tooLargeTotal: (bytes: number) =>
      `These files are too large together. They can add up to ${megabytes(bytes)}.`,
    duplicate: (name: string) => `${name} is already attached.`,
    notSent: "Those files were not sent.",
    open: (name: string) => `Download ${name}`,
    fault: {
      material_type_not_accepted:
        "The coordinator cannot read that kind of file.",
      disallowed_mime_type: "The coordinator cannot read that kind of file.",
      material_missing: "Pick a file to attach.",
      invalid_form: "Those files could not be read. Try attaching them again.",
      too_many_attachments: "That is too many files for one message.",
      oversize_attachment: "One of those files is too large.",
      oversize_total: "Those files are too large together.",
      invalid_attachment_name:
        "One of those file names cannot be used. Rename it and try again.",
      coordinator_not_running:
        "The coordinator is not running, so it cannot receive files yet.",
      artifact_write_refused: "Files cannot be added to this project.",
    } as Record<string, string>,
  },
  projectImported: "Project imported",
  /** The opened body of a specialist's reports. */
  reported: "What they reported",
  /** A specialist's reports, named by what they were about: "Constraints", "Build · 4 updates". */
  updates: (subject: string, count: number) =>
    count === 1 ? subject : `${subject} · ${String(count)} updates`,
  /** More than a few report rows in a row, folded under one line. */
  updatesFolded: (count: number) => `${String(count)} specialist updates`,
  /** What the coder's reports are about. */
  buildSubject: "Build",
  approval: {
    approve: "Yes, go ahead",
    notYet: "Not yet",
    decline: "Decline",
    /** The composer's placeholder while an approval is open: a message declines it, with these words as the reason. */
    composerPlaceholder: "Say what you'd like changed, or ask a question…",
    /** A whole message that approves the one open card, after a countdown the person can undo. */
    typedYes: {
      affirmations: [
        "yes",
        "yep",
        "yeah",
        "ok",
        "okay",
        "sure",
        "approve",
        "approved",
        "go",
        "go ahead",
        "yes go ahead",
        "do it",
        "make it happen",
        "sounds good",
        "lgtm",
        "ship it",
      ] as readonly string[],
      countdown: (seconds: number) => `Approving in ${String(seconds)}s`,
      undo: "Undo",
      undoHint: "Undo sends your message instead",
    },
    /** An ask that names no tool. */
    unnamed: "Happy for this to go ahead?",
    /** The settled line of an ask that names no tool. */
    settledUnnamed: "the request",
    /** An ask by its tool and main argument. */
    tool: (tool: string, subject?: string) =>
      subject === undefined
        ? `Let the specialist use ${tool}?`
        : `Let the specialist use ${tool} on ${subject}?`,
    /** A document's name as an earlier-document warning says it. */
    shortName: {
      problem_brief: "brief",
      constraints: "constraints",
      approaches: "approaches",
      product_requirements: "requirements",
      build_plan: "build plan",
      design: "design",
      approval_package: "approval package",
    } as Record<string, string>,
    /** A decided card's one line: "Approved · the request". */
    approved: (line: string) => `Approved · ${line}`,
    /** A declined card's one line. */
    declined: "Not yet",
    packages: (list: string) => `Install ${list} into your project?`,
    packagesDetail: "The coder needs these to do the work.",
    packagesAllowed: (list: string) => `Allowed · ${list}`,
    /** Allows every later install in this build or change without asking; the next one asks again. */
    packagesAlways: "Always allow",
    packagesDeclined: (list: string) => `Declined · ${list}`,
    /** A decided card's line when the decision stands for the rest of the run. */
    always: (line: string) => `${line} · from now on`,
  },
  passage: { addToPrompt: "Add to prompt" },
  documentBar: "Document controls",
  printDocument: "Save as PDF or print",
  removeAttachment: {
    menu: "Remove attachment…",
    confirm: "Yes, remove it",
    done: (name: string, told: boolean) =>
      told
        ? `${name} is removed; the coordinator has been told.`
        : `${name} is removed.`,
    failed: "The attachment could not be removed.",
  },
  versions: {
    menu: (version: number) => `Version ${String(version)}, pick a version`,
    comparePrevious: "Compare with previous",
    comparing: (older: number, newer: number) =>
      `Comparing v${String(older)} → v${String(newer)}`,
    stopComparing: "Stop comparing",
  },
  preview: {
    actions: "Preview controls",
    screen: "Screen",
    defaultState: "Default",
    /** The strip of one-click states for the screen shown: "States of Home". */
    states: (screen: string) => `States of ${screen}`,
    theme: "Switch light and dark",
    desktop: "Desktop",
    phone: "Phone",
    expand: "Expand to full screen",
    expandedTitle: "Preview",
  },
  /** Live look tweaks over the design mockup, kept only when the person sends them. */
  tweak: {
    open: "Tweak the look",
    panel: "Look tweaks",
    primary: "Primary colour",
    background: "Background",
    radius: "Corner radius",
    font: "Font",
    fonts: {
      current: "Mockup's own",
      system: "System sans",
      serif: "Serif",
      rounded: "Rounded",
      mono: "Monospace",
    } as Record<string, string>,
    reset: "Reset",
    save: "Save these",
    /** Where a save landed; it never approves the design. */
    saved: (updated: readonly ("workspace" | "version")[]) =>
      `${updated.includes("version") ? "Saved as a new version of the design" : "Saved to the designer's draft"}${updated.length > 1 ? " and the designer's draft" : ""}. Saving does not approve it.`,
    saveFailed: "The look could not be saved.",
  },
  message: {
    actions: "Message actions",
    copy: "Copy",
    copied: "Copied",
    copyFailed: "That could not be copied.",
    coordinatorStopped: "The coordinator stopped before it replied.",
    coordinatorNotStarted: "The coordinator for this project did not start.",
    projectNotOpened: "The project could not be opened.",
    projectLoading: "Loading this project…",
    projectEmpty:
      "Describe what you want to make or change to start a project.",
    stepFailed: "That step could not finish.",
  },
  /** The coordinator's questions as a card the person answers in the conversation. */
  questions: {
    /** The card's heading by how many questions it asks; three or more read "a few". */
    title: (count: number) =>
      ({ 1: "A question for you", 2: "A couple of questions for you" })[
        count
      ] ?? "A few questions for you",
    /** Where the open question sits among them, beside the heading. */
    position: (at: number, count: number) =>
      `${String(at)} of ${String(count)}`,
    /** The list of questions, answered ones above the open one. */
    thread: "Questions",
    pickOne: "Pick one",
    pickAny: "Pick any that apply",
    selected: (picked: number, count: number) =>
      `${String(picked)} of ${String(count)} selected`,
    /** The row where the person types their own answer instead. */
    other: "Something else…",
    otherAnswer: "Your own answer",
    changeAnswer: (prompt: string, answer: string) =>
      `Change your answer to "${prompt}": ${answer}`,
    earlier: (count: number) =>
      count === 1 ? "1 earlier answer" : `${String(count)} earlier answers`,
    /** After the next question, how many more follow it. */
    more: (count: number) => `+${String(count)} more`,
    back: "Back",
    next: "Continue",
    backKeys: "Previous question (←)",
    nextKeys: "Next question (Enter or →)",
    sendKeys: "Send your answers (Enter)",
    composerPlaceholder: "Or reply in your own words…",
    send: "Send answers",
    sending: "Sending…",
    /** Closes an open question without choosing; the reply is what the settled card then shows. */
    cancel: "Cancel",
    cancelReply: "Cancelled without choosing.",
    notSent: "Your answers were not sent. Your choices are kept; try again.",
    /** How the conversation map marks an answered question. */
    answered: "Answered",
    /** What a settled question says was asked when the person wrote back instead of choosing. */
    answeredInWords: "Answered in your own words",
    /** In place of a plugin's screen the interface has no view for, or whose input it refuses. */
    screenUnavailable:
      "This question cannot be shown here. Answer it in your own words below.",
    screenLoading: "Loading…",
    /** In the conversation while a screen placed over the room is open but closed for now. */
    pageScreenOpen: "Waiting for your review.",
    pageScreenReopen: "Open",
    /** Beside Send, and its name, while a screen's decision has items to send back, such as "2 comments". */
    sendBack: (items: string) => `Send feedback · ${items}`,
    /** What the prompt box asks meanwhile. */
    sendBackReply: (items: string) =>
      `Add a note (optional). ${items} will be sent.`,
  },
  /** Why the mockup review cannot record an approval of the design it shows. */
  designReview: {
    draftNotApprovable:
      "The designer is still working; approve once it is filed.",
    noOption: "Only a filed design option can be approved here.",
    approved: "This design is already approved.",
  },
  archivedProject: {
    title: "This project is archived",
    lead: "Everything it made stays open to read and download. Restore it to work on it again.",
    restore: "Restore",
    restoring: "Restoring…",
    restoreFailed: "The project could not be restored.",
    conversationTitle: "The conversation is closed",
    conversationLead:
      "Restore the project to see its conversation and continue it.",
  },
  providers: {
    section: "Providers",
    lead: "Where the models come from. Keys are kept encrypted and never shown again.",
    add: "Add provider",
    connect: "Connect a model provider",
    none: "No model provider connected",
    noneHint: `${productName} needs one before a project can start.`,
    addLater: "You can add one later in Settings → Providers.",
    login: (label: string) => `Sign in with ${label} (subscription)`,
    loginConnection: (label: string) => `${productName} ${label} sign-in`,
    loginUnsupported: (label: string) =>
      `${productName} cannot sign in to ${label} yet.`,
    signIn: "Sign in",
    signInAgain: "Sign in again",
    waiting: "Waiting for sign-in…",
    timedOut: "The sign-in timed out.",
    notConnected: "Not connected",
    loginGroup: "Connect with a subscription",
    apiKeyGroup: "Connect providers via API key",
    dialogTitle: "Add a model provider",
    dialogLead:
      "Pick a provider, paste its key, and test it. It is saved once the test passes.",
    connectOne: (label: string) => `Connect ${label}`,
    keyLead: "Paste its API key and test it. It is saved once the test passes.",
    provider: "Provider",
    baseUrl: "Base URL",
    key: "API key",
    keyless: "Keyless",
    keylessHint: `For servers that need no API key; ${productName} sends a placeholder.`,
    custom: {
      tile: "Custom server",
      modelsUnreadable:
        "This provider's models could not be read, so nothing was saved.",
      tileHint: "Your own server, on the API it speaks.",
      addTitle: "Add a custom server",
      addLead: "Connect your own server. It is saved once the test passes.",
      name: "Name",
      api: "API type",
      apiLead: "Pick the API your server speaks.",
      apiPaths: {
        "openai-compatible": "/v1/chat/completions",
        "openai-responses": "/v1/responses",
        anthropic: "/v1/messages",
      },
      apiTips: {
        "openai-compatible":
          "OpenAI's chat format. vLLM, Ollama, LM Studio, llama.cpp and most hosted servers use it.",
        "openai-responses":
          "OpenAI's newer Responses format. OpenAI and a few servers that copy it use it.",
        anthropic:
          "Anthropic's Messages format. Anthropic and servers that copy it use it.",
      },
      tips: {
        name: `What this server is called in ${productName}.`,
        api: "The request format your server understands.",
        baseUrl: "The address requests go to, usually ending in /v1.",
        key: "The key your server asks for. Kept encrypted and never shown again.",
        modelId: "The exact model name your server expects.",
        modelName: "How the model is shown. Empty shows its model ID.",
        contextWindow: "How much text the model can read at once.",
        maxOutputTokens:
          "The most text it writes in one reply. Below the context window.",
      },
      about: (label: string) => `About ${label}`,
      models: "Models",
      modelCount: (count: number) =>
        count === 1 ? "1 model" : `${count} models`,
      duplicateIds: "Each model needs its own model ID.",
      modelId: "Model ID",
      modelName: "Name",
      optional: "Optional",
      contextWindow: "Context window",
      maxOutputTokens: "Output cap",
      addModel: "Add model",
      removeModel: (id: string) => `Remove ${id}`,
      keyAgain: "A new API type or base URL needs its key again, or Keyless.",
      editTitle: (label: string) => `Edit ${label}`,
      editLead:
        "Change its name or connection. A new API type, base URL or key is tested before it is saved.",
      options: (label: string) => `Options for ${label}`,
      edit: "Edit",
      remove: "Remove…",
      confirmRemove: "Yes, remove it",
      back: "Back",
      save: "Save",
      saving: "Saving…",
      savedState: "Saved",
      failedState: "Not saved",
      saved: (label: string) => `${label} saved`,
      removed: (label: string) => `${label} removed`,
    },
    test: "Test connection",
    testing: "Testing…",
    saved: (label: string) => `${label} connected`,
    status: {
      connected: "Connected",
      refused: "Key refused",
      unavailable: "Not reachable",
      unconfigured: "No key",
    },
    failed: {
      refused: "The provider refused this key. Check it and try again.",
      unavailable:
        "The provider did not answer with a model list. Check the URL and try again.",
      unconfigured: "The provider did not accept this key.",
    },
  },
  profiles: {
    section: "Profiles",
    lead: "A profile sets the model and effort of four tiers, and each role runs on one of them. Each project keeps the profile it started with.",
    newProfile: "New profile",
    editProfile: "Edit profile",
    editorLead: "Pick the provider, model and effort for each tier.",
    startFrom: "Start from",
    blank: "Blank",
    copyName: (label: string) => `${label} copy`,
    name: "Name",
    choose: "Pick…",
    save: "Save profile",
    yours: "Made by you.",
    active: "Active",
    use: "Use",
    edit: "Edit",
    delete: "Delete",
    detail: (label: string) => `What ${label} runs`,
    show: "Details",
    tier: (label: string) => `${label} tier`,
    usedBy: (roles: readonly string[]) =>
      roles.length ? `Used by ${roles.join(", ")}.` : "No role uses this tier.",
    binding: (model: string, provider: string | null, effort: string) =>
      `${model}${provider ? ` on ${provider}` : ""}, ${effort.toLowerCase()} effort`,
    effortOption: (effort: string) => `${effort} effort`,
    unavailable:
      "Its provider is not connected, so a project cannot start on it.",
    unavailableOption: (label: string) => `${label} (not connected)`,
    provider: (tier: string) => `${tier} provider`,
    model: (tier: string) => `${tier} model`,
    effort: (tier: string) => `${tier} effort`,
    pick: "Model profile",
    replaceDefault: (name: string) =>
      `Do you want to make this your new default profile? It will replace ${name}.`,
  },
  settings: {
    title: "Settings",
    sections: "Settings sections",
    tab: {
      providers: "Providers",
      profiles: "Profiles",
      preferences: "Preferences",
      collaborators: "Collaborators",
      about: "About",
    },
    about: {
      section: `About ${productName}`,
      lead: "One coordinator that brings in specialists to build, edit, improve or write anything.",
      openSource: "Open source",
      openSourceLead:
        "Work from others this product carries beyond its npm packages, whose licenses ship with them.",
      kind: {
        vendored: "Copied in",
        binary: "Binary",
        patched: "Patched",
      },
      unconfirmed: "License: see the original project",
    },
    preferences: {
      section: `How ${productName} works with you`,
      lead: "What you say in a project wins.",
      saving: "Saving…",
      saved: "Saved",
      failed: "Not saved",
      experimental: [
        {
          id: "experimental_approvals",
          label: "Approvals (experimental)",
          hint: "On, share tailored approval packages with stakeholders, track reviewer status (Pending feedback, Approve), and add feedback to your prompt.",
          options: [
            { id: "no", label: "Off" },
            { id: "yes", label: "On" },
          ],
          default: "no",
        },
      ],
    },
    approvals: {
      section: "Workspace approvals",
      lead: "Control whether projects use stakeholder approval packages and manage saved reviewers across this workspace.",
      requireLabel: "Require stakeholder approval",
      requireHint:
        "When off, stakeholder approval packages are bypassed and the Approval tab is hidden in projects.",
      reviewersSubhead: "Workspace reviewers",
      reviewersLead:
        "Saved reviewers can be picked with one click when sharing an approval package in any project.",
      reviewerName: "Reviewer name",
      reviewerPersona: "Persona",
      reviewerEmail: "Email (optional)",
      reviewerGoal: "Goal or decision focus (optional)",
      addReviewer: "Add reviewer",
      removeReviewer: "Remove",
      emptyReviewers: "No saved workspace reviewers yet.",
    },
    appearance: {
      section: "Appearance",
      lead: "Follows the system until you say otherwise.",
      theme: "Theme",
      themes: { light: "Light", system: "System", dark: "Dark" },
    },
    account: {
      section: "Account",
      lead: "Who you are on this server.",
      name: "Name",
      email: "Email",
    },
    collaborators: {
      refused: {
        invitation_delegation_refused:
          "You can only invite someone to a role whose access you hold yourself.",
        invitation_management_refused:
          "Your role does not let you manage invitations.",
        invitation_role_too_large:
          "That role has too many permissions to offer by invitation.",
        invitation_role_not_found: "That role no longer exists. Pick another.",
        invalid_invitation: "Enter a valid email address and pick a role.",
        human_session_required: "Sign in again to invite collaborators.",
      } as Record<string, string>,
      failed: "That did not go through. Try again.",
    },
  },
  approvalRound: {
    heading: "Share for sign-off",
    lead: "Add each person reviewing this package to download their personalised .zip (slide deck, PDF, README and pinned source documents) and track their sign-off or feedback.",
    shareButton: "Add new reviewer",
    shareSubmitButton: "Add reviewer",
    shareFormLegend: "Add new reviewer",
    cancelShare: "Cancel",
    dialogTitle: "Add new reviewer",
    dialogDescription:
      "Add a reviewer to tailor their approval package and track feedback.",
    expiryLabel: "Expires in",
    expiry: {
      "24h": "24 hours",
      "7d": "7 days",
      "30d": "30 days",
    },
    reviewerRowLabel: (index: number) => `Reviewer ${String(index)}`,
    reviewerName: "Reviewer name",
    reviewerNamePlaceholder: "Reviewer name",
    reviewerPersona: "Persona",
    reviewerPersonaPlaceholder: "Pick a role or persona…",
    reviewerPersonas: [
      "Project owner",
      "Budget approver",
      "Technical approver",
      "Audience member",
      "Builder operator",
      "Delivery recipient",
      "CEO",
      "CTO",
      "VP Product",
      "Investor",
      "Client",
      "End user",
    ],
    otherPersona: "Other…",
    customPersonaLabel: "Custom persona",
    customPersonaPlaceholder: "Type custom role or persona…",
    addCustomPersona: "Add",
    workspaceReviewerLabel: "Pick from workspace",
    workspaceReviewerPlaceholder: "Pick a saved reviewer…",
    workspaceReviewerOption: (name: string, persona: string) =>
      `${name} (${persona})`,
    saveToWorkspaceLabel: (name: string) =>
      name === "" ? "Save to workspace?" : `Save ${name} to workspace?`,
    saveToWorkspaceNote: "Save reviewer for future projects",
    saveToWorkspaceTooltip:
      "Saves this reviewer to the workspace so you can pick them in any project without retyping their details.",
    reviewerEmail: "Email (optional)",
    reviewerEmailPlaceholder: "Optional",
    reviewerGoal: "Goal or decision focus (optional)",
    reviewerGoalPlaceholder:
      "What decision or sign-off does this person focus on?",
    defaultGoal: (persona: string) =>
      `Review and sign off from the ${persona} perspective.`,
    tableHeaders: {
      reviewer: "Name",
      role: "Role",
      goal: "Focus",
      status: "Status",
    },
    fieldLabels: {
      saved: "Saved",
      name: "Name",
      role: "Role",
      focus: "Focus",
      email: "Email",
      workspace: "Workspace",
      expires: "Expires",
      decision: "Decision",
      feedback: "Feedback",
    },
    pendingOutcome: "Pending",
    inlineFeedbackPlaceholder: "Add feedback note…",
    saveField: "Save",
    savingField: "Saving…",
    reviewerDetailsSaved: (name: string) => `Saved details for ${name}.`,
    tailorPrompt: (name: string, persona: string, goal: string) =>
      `Generate a slide deck for ${name} (${persona}) focused on: ${goal}.`,
    tailorRequested: (name: string) =>
      `Asked the coordinator to tailor the package for ${name}.`,
    generateSlideDeck: "Generate slide deck",
    generatingSlideDeck: "Generating slide deck…",
    viewSlideDeck: "View slide deck",
    slideDeckDialogTitle: (name: string, role: string) => `${name} — ${role}`,
    downloadDialogTitle: (name: string) => `Download package — ${name}`,
    downloadSectionLead:
      "All package files are selected by default. Uncheck any items you do not want to include for this reviewer.",
    downloadAllButton: "Download all",
    downloadSelectedCount: (count: number) =>
      count === 1 ? "Download 1 file" : `Download ${String(count)} files`,
    selectAllFiles: "Select all",
    deselectAllFiles: "Deselect all",
    packageItemPptx: "Slide deck (.pptx)",
    packageItemPdf: "Printable handout (.pdf)",
    packageItemSource: (kindLabel: string, title: string, version: number) =>
      `${kindLabel} — ${title} (v${String(version)})`,
    addReviewer: "Add reviewer",
    removeReviewer: "Remove",
    startingRound: "Adding…",
    roundHeading: (version: number) => `Package v${String(version)} reviewers`,
    roundStatus: {
      open: "Open",
      expired: "Expired",
      settled: "Settled",
    },
    reviewerState: {
      sent: "Sent",
      decided: "Decided",
      expired: "Expired",
    },
    downloadReviewerZip: (name: string) =>
      `Download approval package for ${name}`,
    downloadZipShort: "Download package",
    downloadingZipShort: "Downloading…",
    outcomeLabel: "Decision",
    outcome: {
      approve: "Approve",
      request_changes: "Pending feedback",
      comment: "Comment",
    },
    noteLabel: "Feedback notes",
    settleRound: "Mark settled",
    settlingRound: "Settling…",
    loading: "Reading reviewers…",
    empty:
      "No reviewers added yet. Add the people reviewing this package to download a .zip for each person and record their sign-off.",
    failed: "That sign-off action did not go through.",
    slidePrefix: (slide: number) => `Slide ${String(slide)}`,
    triageHeading: "Feedback to review",
    triageStatus: {
      pending: "Pending",
      incorporated: "Added to prompt",
      dismissed: "Dismissed",
      replied: "Replied",
    },
    incorporate: "Add to prompt",
    dismiss: "Dismiss",
    reply: "Reply",
    overallScope: "Overall",
  },
} as const;
