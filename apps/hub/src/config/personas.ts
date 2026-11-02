export const AUDIENCE_PERSONA_IDS = [
  "ceo",
  "cto",
  "investor",
  "client",
  "end_user",
] as const;

export type AudiencePersonaId = (typeof AUDIENCE_PERSONA_IDS)[number];

export type PersonaDocumentKind =
  | "problem_brief"
  | "constraints"
  | "approaches"
  | "product_requirements"
  | "build_plan";

export type AudiencePersona = Readonly<{
  id: AudiencePersonaId;
  label: string;
  cares: readonly string[];
  defaultDocuments: readonly PersonaDocumentKind[];
  length: string;
  tone: string;
}>;

// The starting audience personas the coordinator offers when a person asks to share or present a
// project. Each pairs what that audience cares about with the documents and deck shape that answer it.
export const AUDIENCE_PERSONAS: readonly AudiencePersona[] = [
  {
    id: "ceo",
    label: "CEO",
    cares: ["business outcome", "strategic fit", "risks", "resource ask"],
    defaultDocuments: ["problem_brief", "approaches", "build_plan"],
    length: "6-8 slides",
    tone: "Executive and direct: lead with the business outcome, strategic fit, key risks and the resource ask.",
  },
  {
    id: "cto",
    label: "CTO",
    cares: [
      "architecture",
      "constraints",
      "security",
      "technical trade-offs",
      "build plan",
    ],
    defaultDocuments: [
      "problem_brief",
      "constraints",
      "approaches",
      "build_plan",
    ],
    length: "8-12 slides",
    tone: "Technical and rigorous: cover the architecture, constraints, security boundaries, technical trade-offs and phased build plan.",
  },
  {
    id: "investor",
    label: "Investor",
    cares: [
      "problem size",
      "differentiation",
      "user value",
      "traction roadmap",
    ],
    defaultDocuments: ["problem_brief", "approaches", "product_requirements"],
    length: "8-10 slides",
    tone: "Crisp and evidence-led: frame the problem size, differentiation, user value and traction roadmap.",
  },
  {
    id: "client",
    label: "Client",
    cares: [
      "capabilities",
      "workflow fit",
      "delivery timeline",
      "sign-off scope",
    ],
    defaultDocuments: ["problem_brief", "product_requirements", "build_plan"],
    length: "8-10 slides",
    tone: "Clear and collaborative: walk through capabilities, workflow fit, delivery timeline and sign-off scope.",
  },
  {
    id: "end_user",
    label: "End user",
    cares: ["day-to-day experience", "screens", "key workflows"],
    defaultDocuments: ["problem_brief", "product_requirements"],
    length: "5-7 slides",
    tone: "Practical and approachable: show the day-to-day experience, screens and key workflows in plain language.",
  },
];

function normalizePersonaKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

export function findAudiencePersona(
  audience: string,
): AudiencePersona | undefined {
  const key = normalizePersonaKey(audience);
  return AUDIENCE_PERSONAS.find(
    (entry) => entry.id === key || normalizePersonaKey(entry.label) === key,
  );
}

export function resolveAudiencePersona(audience: string): AudiencePersona {
  const matched = findAudiencePersona(audience);
  if (matched) return matched;
  return {
    id: "client",
    label: audience.trim(),
    cares: ["decision needed", "key outcomes", "scope and delivery"],
    defaultDocuments: ["problem_brief", "product_requirements", "build_plan"],
    length: "6-10 slides",
    tone: "Clear, concrete and tailored to what this audience needs to decide.",
  };
}

export function formatPersonaGuidance(persona: AudiencePersona): string {
  return [
    `Audience persona: ${persona.label} (${persona.id})`,
    `What they care about: ${persona.cares.join(", ")}`,
    `Default documents: ${persona.defaultDocuments.join(", ")}`,
    `Recommended length: ${persona.length}`,
    `Recommended tone: ${persona.tone}`,
  ].join("\n");
}

export function formatPersonasCatalog(): string {
  return AUDIENCE_PERSONAS.map(
    (persona) =>
      `- ${persona.label} (${persona.id}): cares about ${persona.cares.join(", ")}; default documents: ${persona.defaultDocuments.join(", ")}; length: ${persona.length}; tone: ${persona.tone}`,
  ).join("\n");
}

export type PresenterSourceRef = Readonly<{
  artifactId: string;
  kind: string;
  title: string;
  version: number;
  sha256: string;
}>;

export type PresenterSourceDocument = PresenterSourceRef &
  Readonly<{
    content: string;
  }>;

export type PresenterDesignTokens = PresenterSourceRef &
  Readonly<{
    designMd: string;
    stylesCss?: string;
  }>;

export type PackageAssignment = Readonly<{
  projectId: string;
  audience: string;
  personaId: AudiencePersonaId;
  personaLabel: string;
  decisionNeeded: string;
  tone: string;
  length: string;
  instruction: string;
  sources: readonly PresenterSourceRef[];
}>;

export type PresenterAssignmentInput = Readonly<{
  projectId: string;
  audience: string;
  decisionNeeded: string;
  tone: string;
  length: string;
  instruction: string;
  documents: readonly PresenterSourceDocument[];
  design?: PresenterDesignTokens;
}>;

export function buildPackageAssignment(
  input: PresenterAssignmentInput,
): PackageAssignment {
  const persona = resolveAudiencePersona(input.audience);
  const documentRefs: PresenterSourceRef[] = input.documents.map((doc) => ({
    artifactId: doc.artifactId,
    kind: doc.kind,
    title: doc.title,
    version: doc.version,
    sha256: doc.sha256,
  }));
  const sources: PresenterSourceRef[] = input.design
    ? [
        ...documentRefs,
        {
          artifactId: input.design.artifactId,
          kind: input.design.kind,
          title: input.design.title,
          version: input.design.version,
          sha256: input.design.sha256,
        },
      ]
    : documentRefs;
  return {
    projectId: input.projectId,
    audience: input.audience.trim(),
    personaId: persona.id,
    personaLabel: persona.label,
    decisionNeeded: input.decisionNeeded.trim(),
    tone: input.tone.trim(),
    length: input.length.trim(),
    instruction: input.instruction.trim(),
    sources,
  };
}

export function presenterAssignmentMessage(
  input: PresenterAssignmentInput,
): string {
  const persona = resolveAudiencePersona(input.audience);
  const assignment = buildPackageAssignment(input);
  const sections: string[] = [
    "# Presenter Assignment",
    formatPersonaGuidance(persona),
    [
      `Chosen audience: ${assignment.audience}`,
      `Decision needed: ${assignment.decisionNeeded}`,
      `Chosen tone: ${assignment.tone}`,
      `Chosen length: ${assignment.length}`,
      `Coordinator instruction: ${assignment.instruction}`,
    ].join("\n"),
    `Pinned package assignment (.builder/package-assignment.json):\n${JSON.stringify(assignment, null, 2)}`,
  ];
  if (input.design) {
    const designLines = [
      `## Project Design Tokens (${input.design.title}, version ${String(input.design.version)}, sha256 ${input.design.sha256})`,
      input.design.designMd,
    ];
    if (input.design.stylesCss) {
      designLines.push(`### styles.css\n${input.design.stylesCss}`);
    }
    sections.push(designLines.join("\n\n"));
  }
  const docsSection = input.documents
    .map(
      (doc) =>
        `## Selected Document: ${doc.title} (kind: ${doc.kind}, artifactId: ${doc.artifactId}, version: ${String(doc.version)}, sha256: ${doc.sha256})\n\n${doc.content}`,
    )
    .join("\n\n");
  sections.push(docsSection);
  return sections.join("\n\n");
}
