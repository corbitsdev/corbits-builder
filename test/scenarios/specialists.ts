/** Scripted specialists more than one scenario starts. */
import {
  call,
  ok,
  results,
  say,
  turn,
  user,
  type Reply,
  type Turn,
} from "./runner.ts";

// check-app outlasts run_shell's 30-second default on a busy machine, the first build most of all.
const CHECK_APP_MS = 180_000;
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

/** Recorded turns whose app checks get the longer time limit the scripted coders use. */
export function withLongerAppCheck(turns: readonly Turn[]): Turn[] {
  return turns.map(({ when, reply, requiredTools }) => {
    const longer: Reply = {};
    if (reply.text !== undefined) longer.text = reply.text;
    if (reply.toolCalls !== undefined)
      longer.toolCalls = reply.toolCalls.map((made) =>
        made.name === "run_shell" && made.arguments["command"] === "check-app"
          ? {
              id: made.id,
              name: made.name,
              arguments: { command: "check-app", timeout: CHECK_APP_MS },
            }
          : made,
      );
    return requiredTools === undefined
      ? { when, reply: longer }
      : { when, reply: longer, requiredTools };
  });
}

/**
 * A coder whose assignment contains the text and that runs the app check on the starter as it is,
 * which refuses it for want of a README and a user manual, and reports that.
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
    // A coder that stops before its app is filed is asked again with the same history, four
    // times in all, before its reply goes to the coordinator.
    ...Array.from({ length: 4 }, () =>
      turn(
        results(ok("coder_check", "run_shell", "check failed")),
        say(options.report),
        CODER_TOOLS,
      ),
    ),
  ];
}
