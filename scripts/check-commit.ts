export function commitProblems(message: string): string[] {
  const errors: string[] = [];
  const lines = message.trim().split(/\r?\n/);
  const subject = lines[0] ?? "";
  if (
    !/^(feat|fix|perf|refactor|test|docs|build|ci|chore|style)(\([a-z][a-z0-9/-]*\))?!?: .+/.test(
      subject,
    )
  ) {
    errors.push("Use a Conventional Commit subject: type(scope): description.");
  }
  if (subject.length > 72)
    errors.push("Keep the commit subject to 72 characters.");
  if (lines.length > 1 && lines[1] !== "")
    errors.push("Separate the subject and body with a blank line.");
  if (/^(?:co-authored-by|signed-off-by|authored-by):/im.test(message))
    errors.push("Do not add attribution trailers.");
  return errors;
}

if (import.meta.main) {
  const messageFile = process.argv[2];
  const message = messageFile
    ? await Bun.file(messageFile).text()
    : Bun.spawnSync(["git", "log", "-1", "--format=%B"], {
        stdout: "pipe",
        stderr: "pipe",
      });
  if (typeof message !== "string" && message.exitCode !== 0)
    throw new Error("Cannot read the current commit.");
  const errors = commitProblems(
    typeof message === "string" ? message : message.stdout.toString(),
  );
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  console.info("Commit format and no-attribution policy verified.");
}
