export const activity = {
  label: "Who is working",
  notRead: "Who is working could not be read.",
  role: {
    coordinator: "Coordinator",
    writer: "Writer",
    reviewer: "Reviewer",
    designer: "Designer",
    coder: "App builder",
    presenter: "Presenter",
  },
  /** Before the run's first tool call: the hub has seen nothing from it yet. */
  starting: "getting started",
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
    deploy_presenter: () => "Started the presenter",
    instruct_coder: () => "Started the app builder on a change",
    review_artifact: (document?: string) =>
      document ? `Asked for a review · ${document}` : "Asked for a review",
  } as Record<string, (subject?: string) => string>,
  /** A hand-off the hub refused, by tool name: who it did not start. */
  handoffRefused: {
    deploy_writer: (document?: string) =>
      document
        ? `Could not start the writer · ${document}`
        : "Could not start the writer",
    design_app: () => "Could not start the designer",
    deploy_coder: () => "Could not start the app builder",
    deploy_presenter: () => "Could not start the presenter",
    instruct_coder: () => "Could not start the app builder on a change",
    review_artifact: (document?: string) =>
      document
        ? `Could not ask for a review · ${document}`
        : "Could not ask for a review",
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
    deploy_presenter: () => "starting the presenter",
    write_deck: () => "building the slide deck",
    check_deck: () => "checking the slide deck",
    file_package: () => "filing the approval package",
    instruct_coder: () =>
      "waiting for you to approve a change for the app builder",
    exec: () => "rewriting a tool call",
  } as Record<string, (subject?: string) => string>,
  /** What a call returned, in plain words, for a tool whose raw result means nothing to a person. */
  toolResult: {
    exec: "The assistant wrote this step in a form the app can't run, so it was asked to write it again.",
  } as Record<string, string>,
  otherTool: (name: string) => `using ${name.replaceAll("_", " ")}`,
  elapsed: (minutes: number, seconds: number) =>
    minutes === 0 ? `${seconds}s` : `${minutes}m`,
} as const;

/** A specialist that ended before finishing, as the thread's quiet notice. */
export const specialistEnded = {
  /** The recorded native failure code in plain words. */
  cause: {
    "crash-mid-invocation": "the server restarted while it was working",
    cancelled: "it was cancelled",
    timeout: "it ran out of time",
    "timed-out": "it ran out of time",
  } as Record<string, string>,
  restart: "The coordinator can start it again.",
  details: "Details",
} as const;

/** A coordinator hand-off and what came of it, as one message in the conversation. */
export const dispatch = {
  /** What a call works on when its arguments name no document or concept. */
  subject: {
    deploy_coder: "the app",
    instruct_coder: "the app",
    design_app: "the design",
    deploy_presenter: "the approval package",
  } as Record<string, string>,
  /** What a hand-off works on when nothing names it yet. */
  unnamed: "the task",
  waiting: "Waiting for your go-ahead",
  /** The run is held on a request only the person can approve, such as a package install. */
  approval: "Paused for your approval",
  /** The hand-off's approval ended without a yes, so nothing started. */
  declined: {
    rejected: "Not started — you said not yet",
    timeout: "Not started — the go-ahead ran out of time",
    expired: "Not started — the go-ahead expired",
  },
  /** The hub refused the hand-off, so nothing started. */
  refused: "Not started",
  starting: "Starting…",
  /** At work before its run reports a step of its own. */
  working: (subject: string) => `Working on ${subject}`,
  /** The folded line once the run filed what it was asked for, by role: "Wrote Approaches". */
  done: {
    writer: (subject: string) => `Wrote ${subject}`,
    reviewer: (subject: string) => `Reviewed ${subject}`,
    designer: (subject: string) => `Drafted ${subject}`,
    coder: (subject: string) => `Built ${subject}`,
    presenter: (subject: string) => `Prepared ${subject}`,
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
  refusedUnknown: "the request failed",
} as const;

/** The opened body of a specialist's reports. */
export const reported = "What they reported";

/** A specialist's reports, named by what they were about: "Constraints", "Build · 4 updates". */
export const updates = (subject: string, count: number) =>
  count === 1 ? subject : `${subject} · ${String(count)} updates`;

/** More than a few report rows in a row, folded under one line. */
export const updatesFolded = (count: number) =>
  `${String(count)} specialist updates`;

/** What the coder's reports are about. */
export const buildSubject = "Build";
