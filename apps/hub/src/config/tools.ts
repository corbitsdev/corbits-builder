export const shellCommands = (commands: readonly string[]) =>
  commands.length === 0
    ? ""
    : ` Builder adds ${commands.join(" and ")} to PATH: each is a shell command to run here like any other, and --help says what it does.`;

const REPORT_VALUES_EXAMPLE =
  '{ "values": [{ "name": "stack.language", "value": "TypeScript" }] }';

export const REPORT_VALUES_DESCRIPTION = `Save project values you learned while working, each as a name and its value, such as ${REPORT_VALUES_EXAMPLE}. Your assignment lists the values your work saves and what each holds; a name it does not list is refused, with the names it saves, and nothing is saved.`;

export const invalidReportValues = (issues: string) =>
  `Nothing was saved: pass the values as ${REPORT_VALUES_EXAMPLE}; ${issues}`;
