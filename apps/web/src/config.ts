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
 * The lead of the hub's notice to the coordinator that a specialist ended before
 * finishing. It mirrors SPECIALIST_ENDED_LEAD in apps/hub/src/config/specialist-ended.ts;
 * the thread shows the rest as a quiet line rather than as words the person typed.
 */
export const SPECIALIST_ENDED_LEAD = "Status update: ";

const megabytes = (bytes: number) =>
  `${String(Math.floor(bytes / 1_048_576))} MB`;

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
        "The hub accepted the create the account but did not return a user.",
    },
    signOutFailed: "Could not sign out.",
    noWorkspace: "You are not a member of any workspace yet.",
    accountUnreadable: "Your account could not be read.",
  },
  hub: {
    timedOut: "The hub did not answer in time. Try again.",
    unreachable: "That request did not reach the hub. Try again.",
    notAnswering: "The hub is not answering",
    slowTitle: (averageMs: number) =>
      `${productName} is responding slowly: about ${(averageMs / 1000).toFixed(1)} seconds per action`,
    slowLead:
      "Everything on this page waits on it. If it stays slow, restart the app; the hub's log says which requests were slow.",
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
    retry: "Retry",
    save: "Save",
    saving: "Saving…",
    signIn: "Sign in",
    signOut: "Sign out",
    tryAgain: "Try again",
    openSettings: "Open Settings",
    unarchive: "Unarchive",
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
    build_plan: "Build Plan",
    design: "Design Plan",
    approval_package: "Approval package",
    app: "App",
  } as Record<string, string>,
  documentUnread: "new version",
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
    tab: "Live Preview",
    title: "The app as it is being built",
    frameTitle: "The running app",
    notBuiltTitle: "Your app appears here",
    notBuilt:
      "The app builder starts it once you confirm a design and approve the documents.",
    setup: {
      working: "The app builder is setting up your app…",
      note: "Your app shows here as soon as the app builder's first changes run.",
      elapsed: (clock: string) => `${clock} elapsed`,
      checking: "Checking on the app builder…",
      unknown:
        "The app builder's progress cannot be read right now; your app shows here once it can.",
      notWritten: "The app builder has not written any of your app yet.",
    },
    phase: {
      installing: "Installing the app's packages",
      starting: "Starting the app",
    },
    filedVersion: (version: number) => `App v${String(version)}`,
    savedWork: (commit: string) => `Latest saved work (${commit.slice(0, 7)})`,
    stopped: "The app is stopped.",
    stoppedNote: "Nothing is running it right now.",
    failed: "The app could not start.",
    restarts: "It starts again when the app's files next change.",
    lastOutput: "The app's last output",
    unavailableTitle: "No app preview here",
    unavailable:
      "This Builder cannot run apps, so the app cannot be shown here.",
    openInNewTab: "Open in a new tab",
    download: "Download the app",
    share: "Share the app",
    demoLogin: (email: string, password: string) =>
      `Demo login: ${email} · ${password}`,
    checklistShow: "Show the acceptance checklist",
    checklistHide: "Hide the acceptance checklist",
    controls: "App controls",
    checklistTitle: "Acceptance checklist",
    checklistProgress: (done: number, total: number) =>
      `${String(done)} of ${String(total)} checked so far.`,
    checklistDone: "Checked",
    checklistOpen: "Not checked yet",
  },
  nextStep: {
    action: {
      open_app: "Open the app",
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
    downloadPackagePdf: "Download the package PDF",
    sharePackagePdf: "Share the package PDF",
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
  newProject: {
    title: "What do you want to build today?",
    lead: "Turn any half-baked idea into an application",
    starting: "Starting your project…",
    titleRequired: "A project needs a title.",
    createFailed: "The project could not be created.",
  },
  appVersion: {
    current: (version: number) => `Downloaded version ${String(version)}.`,
    saved: (version: number, source: string | undefined, why: string) =>
      `Version ${String(version)}, the latest saved${source === undefined ? "" : ` (${source === "check" ? "after a passing check" : source === "snapshot" ? "a snapshot" : "imported"})`}. ${why}`,
    none: (why: string) => `No version of the app is saved yet. ${why}`,
    savedWork: "Downloaded the app builder's latest saved work.",
    why: {
      forbidden:
        "You can view this project but not save a new version of its code.",
      coder_run_not_found: "The app builder has not started on the code yet.",
      app_workspace_unavailable:
        "The app builder's working copy cannot be read from here, so its current code is not in it.",
      tooLarge: (bytes: number, limit: number) =>
        `The current code is ${String(bytes)} bytes, over the ${String(limit)}-byte limit, so it is not in it.`,
      failed: (status: number, code: string) =>
        `Saving the current code failed (HTTP ${String(status)}, ${code}), so it is not in it.`,
    },
    refused: (status: number, code: string) =>
      `The hub refused the request: HTTP ${String(status)}, ${code}.`,
    unreadable:
      "The hub's answer could not be read; it may be an older hub that has not been restarted.",
  },
  exportProject: {
    title: "Export the project",
    loading: "Checking what this project has to export…",
    sectionsFailed: (reason: string) =>
      `Only the planning documents can be offered: ${reason}`,
    sections: {
      planning: "Planning documents",
      design: "Design documents and mockups",
      build: "Build",
    },
    action: "Export",
  },
  importProject: {
    action: "Import project",
    source: `A project ${productName} or the original Solution Builder exported`,
    invalid: `This file is not a project ${productName} or the original Solution Builder exported.`,
    omitted: (kinds: string[]) => `Not carried over: ${kinds.join(", ")}.`,
  },
  shell: {
    back: "Back",
    newProject: "New project",
    projectOptions: (title: string) => `Options for ${title}`,
    projects: "Projects",
    inProgress: "Projects in progress",
    settings: "Settings",
    untitledProject: "Project",
    noProjectTitle: "No project open",
    noProjectLead:
      "Choose a project from the list. Chat stays on the left and outputs on the right.",
  },
  projectLoadFailure: {
    title: "This project couldn't be opened",
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
    filterLabel: "Show projects by stage",
    all: "All",
    filter: {
      idea: "Idea",
      building: "Building",
      shipped: "Shipped",
      archived: "Archived",
    },
    lastActivity: (relative: string) => `Active ${relative}`,
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
    empty: "Nothing in the conversation yet",
    emptyLead: "Replies show here. Saved documents show on the right.",
    startingCoordinator: "Starting the coordinator…",
    dropFiles: "Drop files to attach them",
    noCoordinator: "This project has no running coordinator.",
  },
  /** What a person's move is waiting on, as the bell and gate name it. */
  wait: {
    permission: "The coordinator asks permission to continue",
    install: "The builder asks to install packages",
    wantsToRun: (toolName: string | undefined) =>
      `Wants to run: ${toolName ?? "a step"}`,
    wantsToInstall: (packages: readonly string[]) =>
      `Wants to install: ${packages.join(", ")}`,
    question: "The coordinator is waiting on you",
    askedInConversation:
      "The coordinator asked a question in the conversation.",
  },
  speaker: {
    coder: "App builder",
    coordinator: "Coordinator",
    specialist: "Specialist",
    you: "You",
  },
  activity: {
    label: "Who is working",
    role: {
      coordinator: "Coordinator",
      writer: "Writer",
      reviewer: "Reviewer",
      designer: "Designer",
      coder: "App builder",
    },
    /** Before the run's first tool call: the hub has seen nothing from it yet. */
    starting: "getting started",
    /** A run still open with nothing seen for a while: done with its task, waiting for the next. */
    idle: "waiting for its next task",
    /** How files and commands read in a status line: plain names, never paths or ids. */
    files: {
      earlierOutput: "earlier results",
      generic: "the app's files",
      checkApp: "a full check of the app",
      command: "a quick check",
      known: {
        "DESIGN.md": "the design notes",
        "README.md": "the read-me",
        "USER-MANUAL.md": "the user manual",
        "ACCEPTANCE.md": "the acceptance checklist",
        "AGENTS.md": "the project guide",
        "package.json": "the app setup",
        "index.html": "the main screen",
        "styles.css": "the styles",
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
    instruction: "Instruction",
    /** An opened step: what it was given and what came back. */
    input: "Details",
    output: "Result",
    outputError: "What went wrong",
    /** A step's state at the end of its row. */
    status: {
      pending: "Queued",
      running: "Working",
      "output-available": "Done",
      error: "Did not finish",
      "approval-requested": "Waiting for you",
      "output-denied": "Not done",
    },
    /** Several steps taken at the same time, as one row. */
    group: {
      ran: (count: number) => `${String(count)} steps at once`,
      running: (count: number, done: number) =>
        `${String(count)} steps at once · ${String(done)} done`,
      held: (count: number, done: number) =>
        `${String(count)} steps at once · ${String(done)} done`,
      waiting: (count: number) => `${String(count)} waiting for you`,
      failed: (count: number) => `${String(count)} did not finish`,
    },
    /** A finished run of tool work with no thinking: its one step by name, else how many. */
    run: (count: number, only?: string) =>
      only === undefined ? `${String(count)} steps` : only,
    /** A run's live line and failure count. */
    trigger: {
      thinking: "Thinking",
      working: "Working",
      runningMany: (count: number) => `Doing ${String(count)} things at once`,
      failed: (count: number) => `${String(count)} did not finish`,
    },
    /** A hand-off in the coordinator's turn, by tool name: who it starts, once started. */
    handoff: {
      deploy_writer: (document?: string) =>
        document ? `Started the writer · ${document}` : "Started the writer",
      design_app: () => "Started the designer",
      deploy_coder: () => "Started the app builder",
      instruct_coder: () => "Sent the app builder a change",
      review_artifact: (document?: string) =>
        document ? `Asked for a review · ${document}` : "Asked for a review",
    } as Record<string, (subject?: string) => string>,
    /** What a tool call is doing, by tool name, given its one identifying argument. */
    tool: {
      read_file: (subject?: string) =>
        subject ? `reading ${subject}` : "reading a file",
      write_file: (subject?: string) =>
        subject ? `writing ${subject}` : "writing a file",
      edit_file: (subject?: string) =>
        subject ? `editing ${subject}` : "editing a file",
      search_files: (subject?: string) =>
        subject
          ? `looking for files matching ${subject}`
          : "looking through files",
      grep: (subject?: string) =>
        subject ? `searching for “${subject}”` : "searching the code",
      run_shell: (subject?: string) =>
        subject ? `running ${subject}` : "running a command",
      read_skill: (subject?: string) =>
        subject
          ? `studying the ${subject.replaceAll("-", " ")} guide`
          : "studying a guide",
      read_artifact: (subject?: string) =>
        subject ? `reading the ${subject}` : "checking the project documents",
      write_artifact: (subject?: string) =>
        subject ? `filing the ${subject}` : "filing a document",
      install_packages: (subject?: string) =>
        subject ? `installing ${subject}` : "installing packages",
      app_status: () => "checking the app preview",
      mail_send: () => "sending a note",
      mail_reply: () => "replying",
      mail_read: () => "reading a note",
      mail_search: () => "reading notes",
      mail_wait: () => "waiting for a reply",
      request_approval: () => "waiting for your approval",
      deploy_writer: () => "starting a writer",
      review_artifact: () => "asking for a review",
      design_app: () => "starting the designer",
      deploy_coder: () => "starting the app builder",
      instruct_coder: () =>
        "waiting for you to approve a change for the app builder",
    } as Record<string, (subject?: string) => string>,
    otherTool: (name: string) => `using ${name.replaceAll("_", " ")}`,
    elapsed: (minutes: number, seconds: number) =>
      minutes === 0 ? `${seconds}s` : `${minutes}m`,
  },
  design: {
    mockupTab: "Design Mockup",
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
      "Its mockup shows here once the designer has drafted your app.",
    conceptSketchingElapsed: (clock: string) => `${clock} elapsed`,
    conceptWaiting: (label: string) =>
      `The designer of your ${label} concept is waiting for its next instruction.`,
    /** The pane bar's control that shows what a design concept is going for. */
    conceptDirection: "What this design mockup is going for",
    /** The conversation's ask to confirm the one filed design concept. */
    confirmOne:
      "If you like the design and want to move on to preparing a build plan, confirm. Otherwise, tell me what to change.",
    /** The same ask when several concepts are filed; each concept's name opens its mockup. */
    confirmSeveral:
      "If you like one of the designs and want to move on to preparing a build plan, confirm it. Otherwise, tell me what to change.",
    confirm: "Confirm",
    confirmConcept: (label: string) => `Confirm the ${label} design`,
    confirming: "Confirming…",
    chosen: (label: string) => `✓ Using ${label}`,
    chooseFailed: "The design could not be chosen.",
  },
  /** Prebuilt looks a person previews, tweaks and picks before any design exists. */
  themes: {
    tab: "Design Themes",
    title:
      "Example mockups of each look. Open one to click through, tweak it and use it for your app.",
    gallery: "Design themes",
    open: (label: string) => `Open the ${label} theme`,
    back: "Back to all design themes",
    loading: "Loading design themes…",
    failed: "The design themes could not load.",
    use: "Use this theme",
    /** The composer message that asks the coordinator to design the app in one theme. */
    message: (label: string, looks: readonly string[]) =>
      looks.length === 0
        ? `Design it in the ${label} theme.`
        : `Design it in the ${label} theme with these looks: ${looks.join(", ")}.`,
    looks: {
      primary: (value: string) => `primary colour ${value}`,
      background: (value: string) => `background ${value}`,
      radius: (rem: number) => `corner radius ${String(rem)}rem`,
      font: (stack: string) => `font ${stack}`,
    },
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
    noSlides: "This approval package contains no slides.",
    speakerNotes: "Speaker notes",
    downloadPdf: "Download PDF",
    downloadPptx: "Download PPTX",
    pdfTitle: "Approval package PDF preview",
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
    choose: "Choose this one",
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
    /** What a call works on when its arguments name no document or concept. */
    subject: {
      deploy_coder: "the app",
      instruct_coder: "the app",
      design_app: "the design",
    } as Record<string, string>,
    /** What a hand-off works on when nothing names it yet. */
    unnamed: "the task",
    waiting: "Waiting for your go-ahead",
    /** The hand-off's approval ended without a yes, so nothing started. */
    declined: {
      rejected: "Not started — you said not yet",
      timeout: "Not started — the go-ahead ran out of time",
      expired: "Not started — the go-ahead expired",
    },
    starting: "Starting…",
    /** At work before its run reports a step of its own. */
    working: (subject: string) => `Working on ${subject}`,
    /** The folded line once the run filed what it was asked for, by role: "Wrote Approaches". */
    done: {
      writer: (subject: string) => `Wrote ${subject}`,
      reviewer: (subject: string) => `Reviewed ${subject}`,
      designer: (subject: string) => `Drafted ${subject}`,
      coder: (subject: string) => `Built ${subject}`,
    },
    /** The run ended without filing what it was asked for. */
    ended: (subject: string) => `Worked on ${subject}`,
    /** The hand-off and the reports under one line: "Wrote Approaches · 3 steps". */
    steps: (line: string, count: number) =>
      count < 2 ? line : `${line} · ${String(count)} steps`,
    ready: (document: string, version: number) =>
      `✓ ${document} v${String(version)} ready`,
    open: "Open",
    failed: (reason: string) => `Did not finish: ${reason}`,
    failedUnknown: "the run stopped without a reason",
    refusedUnknown: "the hub refused it",
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
      material_missing: "Choose a file to attach.",
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
    /** The composer's placeholder while an approval is open: a message leaves the card open. */
    composerPlaceholder:
      "Ask a question, or choose Not yet to request changes…",
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
    /** What a teammate would ask, by the native ask. A document ask names its document. */
    question: {
      design_app: () => "Ready to start the design?",
      instruct_coder: () => "Send this change to the app builder?",
    } as Record<string, (subject?: string) => string>,
    document: (document: string) => `Happy with the ${document}?`,
    /** A request_approval ask that covers several documents, by their short names. */
    documents: (names: readonly string[]) =>
      `Happy with the ${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}?`,
    /** An ask with no wording of its own and no document, by its tool and main argument. */
    tool: (tool: string, subject?: string) =>
      subject === undefined
        ? `Let the app builder use ${tool}?`
        : `Let the app builder use ${tool} on ${subject}?`,
    /** The line under an ask that covers no one document. */
    body: {
      design_app: "If these look right, the design starts from them.",
    } as Record<string, string>,
    /** What the card asks the person to approve, so several open cards never blur together. */
    approving: {
      document: (title: string, version: number, by: string) =>
        `Approving ${title} v${String(version)}, written by the ${by}.`,
      documents: "Approving each of these documents at the version listed.",
      design_app: "Approving the start of the design from these documents.",
      instruct_coder: "Approving this change, sent to the app builder.",
    },
    /** Who wrote a document, by its kind; any other kind is a writer's. */
    writtenBy: {
      problem_brief: "Coordinator",
      design: "Designer",
    } as Record<string, string>,
    writer: "Writer",
    /** The document written after this one once it is approved, and the line saying so. */
    nextDocument: {
      problem_brief: "Constraints",
      constraints: "Approaches",
      approaches: "Requirements",
      product_requirements: "Design",
      design: "Build plan",
      build_plan: "App",
    } as Record<string, string>,
    next: (document: string) => `Next on approval: ${document}.`,
    /** The design concepts a design ask starts, listed by name. */
    concepts: "Design concepts to compare",
    /** An ask's own action labels, by its tool, where the defaults read wrong. */
    actions: {
      design_app: {
        approve: "Start the design",
        /** Later design starts in this project's run go ahead without a card. */
        approveAlways: "Start designs without asking",
        deny: "Not yet",
      },
    } as Record<
      string,
      { approve: string; approveAlways?: string; deny: string }
    >,
    /** A document the card lists, as a link: "Weather App Brief v2". */
    source: (title: string, version: number) => `${title} v${String(version)}`,
    /** A document a several-document approval lists, with who wrote it. */
    writtenSource: (title: string, version: number, by: string) =>
      `${title} v${String(version)}, written by the ${by}`,
    /** Folds the exact versions a several-document card covers. */
    covers: (count: number) => `Covers ${String(count)} documents`,
    /** Folds what the specialist is told under the card. */
    details: "Details",
    /** A document's name as the card says it. */
    shortName: {
      problem_brief: "brief",
      constraints: "constraints",
      approaches: "approaches",
      product_requirements: "requirements",
      build_plan: "build plan",
      design: "design",
      approval_package: "approval package",
    } as Record<string, string>,
    openOnRight: "It's open on the right.",
    /** Takes the reading pane back to the document the card asks about. */
    show: (document: string) => `Show ${document}`,
    /** A decided card's one line, where it was asked. */
    approved: (document: string) => `Approved · ${document}`,
    /** What an approved ask let go ahead, as its decided line names it: "Approved · the design". */
    settled: {
      design_app: "the design",
      instruct_coder: "the change for the app builder",
    } as Record<string, string>,
    /** A declined card's one line: "Not yet · Approaches". */
    declined: (documents?: string) =>
      documents === undefined ? "Not yet" : `Not yet · ${documents}`,
    packages: (list: string) => `Install ${list} into your app?`,
    packagesDetail: "The app builder needs these to build your app.",
    packagesAllowed: (list: string) => `Allowed · ${list}`,
    /** Allows every later install in this build without asking. */
    packagesAlways: "Always allow",
    packagesDeclined: (list: string) => `Declined · ${list}`,
    /** A decided card's line when the decision stands for the rest of the run. */
    always: (line: string) => `${line} · from now on`,
  },
  passage: { addToPrompt: "Add to prompt" },
  documentBar: "Document controls",
  printDocument: "Save as PDF or print",
  versions: {
    menu: (version: number) => `Version ${String(version)}, choose a version`,
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
      `${updated.includes("version") ? "Saved as a new version of the design" : "Saved to the designer's draft"}${updated.length > 1 ? " and the designer's draft" : ""}. Saving doesn't approve it.`,
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
    projectTooShort: "At least ten characters to start a project.",
    stepFailed: "That step could not finish.",
  },
  /** The coordinator's questions as a card the person answers in the conversation. */
  questions: {
    title: "A few questions before going on",
    other: "Other",
    otherAnswer: "Your own answer",
    send: "Send answers",
    sending: "Sending…",
    notSent: "Your answers were not sent. Your choices are kept; try again.",
    /** The settled card's one line: each question's answer, in order. */
    answered: (answers: readonly string[]) =>
      `Answered: ${answers.join(" · ")}`,
    answeredInChat: "Answered in the conversation.",
    replaced: "Replaced by the questions that followed.",
    /** One list item of the person's reply per question: "- Who signs in? — Staff, Guests". */
    answerLine: (prompt: string, answers: readonly string[]) =>
      `- ${prompt} — ${answers.join(", ")}`,
  },
  archivedProject: {
    title: "This project is archived",
    lead: "Its documents, design, and app stay open to read and download. Restore it to work on it again.",
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
    login: (label: string) => `Login with ${label} (Subscription)`,
    loginConnection: (label: string) => `${productName} ${label} login`,
    signIn: "Log in",
    signInAgain: "Log in again",
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
    editorLead: "Choose the provider, model and effort for each tier.",
    startFrom: "Start from",
    blank: "Blank",
    copyName: (label: string) => `${label} copy`,
    name: "Name",
    choose: "Choose…",
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
      lead: "Turns an idea into documents, approvals and a built app.",
      openSource: "Open source",
      openSourceLead:
        "Work from others this product carries beyond its npm packages, whose licenses ship with them.",
      kind: {
        vendored: "Vendored",
        binary: "Binary",
        patched: "Patched",
      },
      unconfirmed: "License: see upstream",
    },
    preferences: {
      section: `How ${productName} works with you`,
      lead: "What you say in a project wins.",
      saving: "Saving…",
      saved: "Saved",
      failed: "Not saved",
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
} as const;
