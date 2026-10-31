import type { WorkflowRole } from "@corbits-builder/schemas/installed-workflows";
import type {
  PreferenceRegistry,
  Preferences,
} from "@corbits-builder/schemas/preferences";
import { productConfig } from "./index.ts";

type PreferenceEntry = Readonly<{
  id: string;
  label: string;
  hint?: string;
  // What agents call it in their guidance.
  topic: string;
  options: readonly Readonly<{ id: string; label: string; guidance: string }>[];
  default: string;
  // The roles whose hub-built context carries this preference.
  roles: readonly WorkflowRole[];
}>;

const ALL_ROLES = [
  "coordinator",
  "writer",
  "designer",
  "coder",
  "reviewer",
] as const;

// How Builder works with a person. Each entry is one setting in Settings, copied onto a
// project when it starts, and delivered as guidance to the roles it names; what the person
// says in the conversation wins over it. Adding a preference is one entry here.
export const PREFERENCES: readonly PreferenceEntry[] = [
  {
    id: "questions",
    label: `How much should ${productConfig.naming.productName} ask you?`,
    topic: "Questions",
    options: [
      {
        id: "every_decision",
        label: "Walk me through every decision",
        guidance:
          "Walk through each open product decision with the person, one at a time.",
      },
      {
        id: "essentials",
        label: "Ask only the essentials",
        guidance:
          "Ask only what you cannot reasonably decide, and record the rest as assumptions they can correct.",
      },
      {
        id: "decide_for_me",
        label: "Just build it — decide for me",
        guidance:
          "The person has handed you the decisions: ask nothing, make the calls, and record them as assumptions they can correct.",
      },
    ],
    default: "essentials",
    roles: ["coordinator"],
  },
  {
    id: "replies",
    label: "Replies",
    topic: "Replies",
    options: [
      {
        id: "concise",
        label: "Concise",
        guidance:
          "Keep what the person reads short: the news and what it means for them.",
      },
      {
        id: "detailed",
        label: "Detailed",
        guidance:
          "Explain in full what the person reads: what changed, why, and what comes next.",
      },
    ],
    default: "concise",
    roles: ["coordinator", "designer", "coder"],
  },
  {
    id: "technical",
    label: "Technical detail",
    hint: "Off, everything is in plain language for someone who is not an engineer.",
    topic: "Technical detail",
    options: [
      {
        id: "no",
        label: "Off",
        guidance:
          "The person is not an engineer: use plain words in anything they read, without code, file names or jargon.",
      },
      {
        id: "yes",
        label: "On",
        guidance:
          "The person is technical: name the stack, files and trade-offs plainly in what they read.",
      },
    ],
    default: "no",
    roles: ALL_ROLES,
  },
  {
    id: "design_concepts",
    label: "Design concepts to compare",
    hint: "How many different looks the designers make when you explore several.",
    topic: "Design concepts",
    options: [
      { id: "one", label: "One", guidance: "Start one design concept." },
      {
        id: "two",
        label: "Two",
        guidance:
          "When the person wants to explore several looks, start two different design concepts.",
      },
      {
        id: "three",
        label: "Three",
        guidance:
          "When the person wants to explore several looks, start three different design concepts.",
      },
      {
        id: "four",
        label: "Four",
        guidance:
          "When the person wants to explore several looks, start four different design concepts.",
      },
      {
        id: "five",
        label: "Five",
        guidance:
          "When the person wants to explore several looks, start five different design concepts.",
      },
    ],
    default: "three",
    roles: ["coordinator"],
  },
  {
    id: "nitpicky",
    label: "Nitpicky review",
    hint: "On, reviews raise small inconsistencies and polish as well as real problems.",
    topic: "Nitpicky review",
    options: [
      {
        id: "no",
        label: "Off",
        guidance: "Reviews raise real problems, not polish.",
      },
      {
        id: "yes",
        label: "On",
        guidance:
          "Reviews look closely and raise small inconsistencies, wording and polish as well as real problems.",
      },
    ],
    default: "no",
    roles: ["coordinator", "reviewer"],
  },
  {
    id: "agent_decides_approvals",
    label: "Let the agent decide approvals",
    hint: "On, each document goes ahead once it is written, without waiting for you to approve it.",
    topic: "Document approvals",
    options: [
      {
        id: "no",
        label: "Off",
        guidance:
          "The person approves each document before the next one is written.",
      },
      {
        id: "yes",
        label: "On",
        guidance:
          "Documents go ahead once filed: tell the person about each one and move on without asking them to approve it.",
      },
    ],
    default: "no",
    roles: ["coordinator"],
  },
  {
    id: "ask_open_questions",
    label: "Ask open questions before approval",
    hint: "On, a document comes to you for approval once its open questions are answered. Off, you can approve it while some are still open.",
    topic: "Open questions",
    options: [
      {
        id: "no",
        label: "Off",
        guidance:
          "The person may approve documents that still have open questions; ask them the ones worth their time.",
      },
      {
        id: "yes",
        label: "On",
        guidance:
          "A document goes to the person for approval once its open questions are answered.",
      },
    ],
    default: "yes",
    roles: ["coordinator"],
  },
  {
    id: "install_any_package",
    label: "Install any package without asking",
    hint: "On, the app builder adds the packages it needs without asking you, from its next build.",
    topic: "Package installs",
    options: [
      {
        id: "no",
        label: "Off",
        guidance: "A person approves each new package.",
      },
      {
        id: "yes",
        label: "On",
        guidance: "New packages install without asking the person.",
      },
    ],
    default: "no",
    // Delivered as the coder deployment the project gets, not as guidance: a running coder keeps
    // the definition it was deployed with.
    roles: [],
  },
  {
    id: "internet_while_building",
    label: "Internet while building",
    hint: "On, the app builder can download packages and reach public websites while it works. Off, it reaches only the npm registry to install packages.",
    topic: "Internet while building",
    options: [
      {
        id: "no",
        label: "Off",
        guidance: "The sandbox reaches only the npm registry.",
      },
      {
        id: "yes",
        label: "On",
        guidance: "The sandbox reaches any public website.",
      },
    ],
    default: "yes",
    // Delivered as the sandbox's network policy when it opens, not as guidance.
    roles: [],
  },
  {
    id: "next_step_line",
    label: "What's next in each project",
    hint: "On, a line at the top of the conversation says who is working and what you do next.",
    topic: "Next step line",
    options: [
      { id: "no", label: "Off", guidance: "No next step line." },
      {
        id: "yes",
        label: "On",
        guidance: "A next step line above the conversation.",
      },
    ],
    default: "no",
    // Read by the interface only.
    roles: [],
  },
];

export function preferenceRegistry(): PreferenceRegistry {
  return {
    preferences: PREFERENCES.map(
      ({ id, label, hint, options, default: fallback }) => ({
        id,
        label,
        ...(hint ? { hint } : {}),
        options: options.map((option) => ({
          id: option.id,
          label: option.label,
        })),
        default: fallback,
      }),
    ),
  };
}

/** The first choice that names no registered preference or option. */
export function invalidPreference(choices: Preferences): string | undefined {
  return Object.entries(choices).find(
    ([id, choice]) =>
      !PREFERENCES.find((entry) => entry.id === id)?.options.some(
        (option) => option.id === choice,
      ),
  )?.[0];
}

/** Every preference, the person's choice where they made one. */
export function resolvePreferences(chosen: Preferences | null): Preferences {
  return Object.fromEntries(
    PREFERENCES.map((entry) => {
      const choice = chosen?.[entry.id];
      return [
        entry.id,
        choice && entry.options.some((option) => option.id === choice)
          ? choice
          : entry.default,
      ];
    }),
  );
}

/** The block a specialist's hub-built assignment carries, empty when no preference applies. */
export function preferenceBlock(
  choices: Preferences,
  role: WorkflowRole,
): string {
  const lines = preferenceGuidance(choices, role);
  return lines.length
    ? "\n\nHow the person wants to work:\n" +
        lines.map((line) => "- " + line).join("\n")
    : "";
}

/** The guidance lines one role works by. */
export function preferenceGuidance(
  choices: Preferences,
  role: WorkflowRole,
): string[] {
  return PREFERENCES.filter((entry) => entry.roles.includes(role)).map(
    (entry) => {
      const option =
        entry.options.find((candidate) => candidate.id === choices[entry.id]) ??
        entry.options.find((candidate) => candidate.id === entry.default)!;
      return `${entry.topic}: ${option.label}. ${option.guidance}`;
    },
  );
}

/** How many design concepts the designers make at once; the options are listed in count order. */
export function designConceptCount(choices: Preferences): number {
  const entry = PREFERENCES.find(
    (candidate) => candidate.id === "design_concepts",
  )!;
  const index = entry.options.findIndex(
    (option) => option.id === choices[entry.id],
  );
  return (
    (index < 0
      ? entry.options.findIndex((option) => option.id === entry.default)
      : index) + 1
  );
}

/** Whether the project's coder adds new packages without a person's approval. */
export function installsAnyPackage(choices: Preferences | null): boolean {
  return resolvePreferences(choices)["install_any_package"] === "yes";
}

/** Whether the project's build sandboxes reach any public host rather than only the npm registry. */
export function opensNetwork(choices: Preferences | null): boolean {
  return resolvePreferences(choices)["internet_while_building"] === "yes";
}

/** Whether a filed document lets the next writer start without the person's approval. */
export function agentDecidesApprovals(choices: Preferences | null): boolean {
  return resolvePreferences(choices)["agent_decides_approvals"] === "yes";
}

/** Whether request_approval waits until the documents it covers have no open questions. */
export function asksOpenQuestions(choices: Preferences | null): boolean {
  return resolvePreferences(choices)["ask_open_questions"] === "yes";
}
