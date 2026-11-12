/** Scripted specialists more than one scenario starts. */
import {
  call,
  CHECK_APP_MS,
  ok,
  results,
  say,
  turn,
  user,
  WEATHER_SPECIALISTS,
  type Turn,
} from "./runner.ts";

const themeImport = '@import "@corbits/react-ui/theme.css";\n';
export const CODER_TOOLS = [
  "read_file",
  "edit_file",
  "run_shell",
  "mail_reply",
];

/**
 * A coder that changes the imported weather app's font: it can open a file of its workspace
 * first, then edits the stylesheet, runs the app check and reports.
 */
export function coderChange(options: {
  assignedWith: string;
  report: string;
  open?: string;
}): Turn[] {
  const edit = call("coder_edit", "edit_file", {
    path: "client/src/styles.css",
    old_string: themeImport,
    new_string:
      themeImport + '\nbody {\n  font-family: "Inter", sans-serif;\n}\n',
  });
  const opening =
    options.open === undefined
      ? [turn(user(options.assignedWith), edit, CODER_TOOLS)]
      : [
          turn(
            user(options.assignedWith),
            call("coder_open", "read_file", { path: options.open }),
            CODER_TOOLS,
          ),
          turn(results(ok("coder_open", "read_file")), edit, CODER_TOOLS),
        ];
  return [
    ...opening,
    turn(
      results(ok("coder_edit", "edit_file")),
      call("coder_check", "run_shell", {
        command: "check-app",
        timeout: CHECK_APP_MS,
      }),
      CODER_TOOLS,
    ),
    turn(
      results(ok("coder_check", "run_shell", "The app is filed as version")),
      say(options.report),
      CODER_TOOLS,
    ),
  ];
}

/** A writer whose assignment contains the text, filing the document at once and reporting. */
export function writerFiles(options: {
  assignedWith: string;
  kind: string;
  content: string;
  report: string;
}): Turn[] {
  return [
    turn(
      user(options.assignedWith),
      call("writer_file", "write_artifact", {
        kind: options.kind,
        title: options.kind.replaceAll("_", " "),
        content: options.content,
      }),
    ),
    turn(results(ok("writer_file", "write_artifact")), say(options.report)),
  ];
}

/**
 * A coder whose assignment contains the text and that runs the app check on the starter as it is,
 * which refuses it for want of a README and a user manual, and reports that. A reply before a
 * passing check is held with a note in the same conversation; the fourth ends the run as not
 * finished, and the coordinator is told so in a hub note.
 */
export function coderChecksStarter(options: {
  assignedWith: string;
  report: string;
}): Turn[] {
  return [
    turn(
      user(options.assignedWith),
      call("coder_check", "run_shell", {
        command: "check-app",
        timeout: CHECK_APP_MS,
      }),
      CODER_TOOLS,
    ),
    turn(
      results(ok("coder_check", "run_shell", "check failed")),
      say(options.report),
      CODER_TOOLS,
    ),
    ...Array.from({ length: 3 }, () =>
      turn(user("Builder held your reply"), say(options.report), CODER_TOOLS),
    ),
  ];
}

/**
 * A coder whose assignment contains the text and that keeps working for a while, running a shell
 * command that only sleeps, then reports without changing a file.
 */
export function coderWorks(options: {
  assignedWith: string;
  seconds: number;
  report: string;
}): Turn[] {
  return [
    turn(
      user(options.assignedWith),
      call("coder_work", "run_shell", {
        command: `sleep ${String(options.seconds)}`,
        timeout: (options.seconds + 60) * 1_000,
      }),
      CODER_TOOLS,
    ),
    turn(
      results(ok("coder_work", "run_shell")),
      say(options.report),
      CODER_TOOLS,
    ),
  ];
}

/**
 * A coder whose assignment contains the text and that reports without changing a file, once the
 * app check passes: the hub holds a coder's reply until the saved app builds.
 */
export const coderReports = (options: {
  assignedWith: string;
  report: string;
}): Turn[] => [
  turn(
    user(options.assignedWith),
    call("coder_check", "run_shell", {
      command: "check-app",
      timeout: CHECK_APP_MS,
    }),
    CODER_TOOLS,
  ),
  turn(
    results(ok("coder_check", "run_shell")),
    say(options.report),
    CODER_TOOLS,
  ),
];

const designer = WEATHER_SPECIALISTS.designer.turns;

/** The recorded weather designer, given one concept of its own by its label. */
export function designerFor(label: string): Turn[] {
  const [first, ...rest] = designer;
  if (first === undefined) throw new Error("The recorded designer is empty");
  return [turn(user(label), first.reply, first.requiredTools), ...rest];
}

/**
 * A second weather designer that acts on the person's comment: it writes the recorded designer's
 * files again, restyles the tagged element as a button, checks and files the design, and reports.
 */
export function redesigner(options: {
  assignedWith: string;
  testid: string;
  report: string;
}): Turn[] {
  const [writes] = designer;
  const css = writes?.reply.toolCalls?.[0]?.arguments["content"];
  if (writes === undefined || typeof css !== "string")
    throw new Error("The recorded designer wrote no stylesheet first");
  const firstLine = css.split("\n")[0] ?? "";
  const tools = writes.requiredTools;
  return [
    turn(user(options.assignedWith), writes.reply, tools),
    turn(
      results(
        ...["des_write_css", "des_write_html", "des_write_doc"].map((id) =>
          ok(id, "write_file"),
        ),
      ),
      call("des2_edit", "edit_file", {
        path: ".builder/designs/styles.css",
        old_string: firstLine,
        new_string: `${firstLine}\n[data-testid="${options.testid}"] { display: inline-block; padding: 0.5rem 1rem; border-radius: 999px; background: var(--primary); color: var(--primary-foreground); }`,
      }),
      tools,
    ),
    turn(
      results(ok("des2_edit", "edit_file")),
      call("des2_check", "check_design", {}),
      tools,
    ),
    turn(
      results(ok("des2_check", "check_design", "check passed")),
      call("des2_file", "file_design_option", {}),
      tools,
    ),
    turn(
      results(ok("des2_file", "file_design_option")),
      say(options.report),
      tools,
    ),
  ];
}
