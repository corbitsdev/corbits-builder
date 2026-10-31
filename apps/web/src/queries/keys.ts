/**
 * One key per hub resource. Every query and every invalidation names its
 * data through here, so a key is spelled once and a prefix match
 * (`invalidateQueries({ queryKey: keys.tenant.all })`) reaches every
 * instance of that resource.
 */
export const keys = {
  workspaces: ["workspaces"] as const,
  designDraft: {
    all: ["designDraft"] as const,
    of: (projectId: string, concept?: string) =>
      ["designDraft", projectId, concept] as const,
  },
  designThemes: {
    all: ["designThemes"] as const,
    of: (projectId: string) => ["designThemes", projectId] as const,
    theme: (projectId: string, themeId: string) =>
      ["designThemes", projectId, themeId] as const,
  },
  acceptedMaterials: {
    all: ["acceptedMaterials"] as const,
    of: (projectId: string) => ["acceptedMaterials", projectId] as const,
  },
  acceptance: {
    all: ["acceptance"] as const,
    of: (projectId: string) => ["acceptance", projectId] as const,
  },
  liveApp: {
    all: ["liveApp"] as const,
    of: (projectId: string) => ["liveApp", projectId] as const,
    presence: (projectId: string) =>
      ["liveApp", projectId, "presence"] as const,
  },
  tenant: {
    all: ["tenant"] as const,
    of: (id: string) => ["tenant", id] as const,
  },
  projects: ["projects"] as const,
  /** Conversation and artifacts for one project room, loaded together. */
  projectActivity: {
    all: ["projectActivity"] as const,
    of: (projectId: string) => ["projectActivity", projectId] as const,
  },
  decidedApprovals: {
    all: ["decidedApprovals"] as const,
    of: (projectId: string) => ["decidedApprovals", projectId] as const,
  },
  projectNextStep: {
    all: ["projectNextStep"] as const,
    of: (projectId: string) => ["projectNextStep", projectId] as const,
  },
  projectRunStates: {
    all: ["projectRunStates"] as const,
    of: (projectId: string) => ["projectRunStates", projectId] as const,
  },
  projectRoom: {
    all: ["projectRoom"] as const,
    of: (projectId: string) => ["projectRoom", projectId] as const,
  },
  projectLifecycle: {
    all: ["projectLifecycle"] as const,
    of: (projectId: string) => ["projectLifecycle", projectId] as const,
  },
  modelCatalog: ["modelCatalog"] as const,
  /** The person's own model choice. */
  modelChoice: ["modelChoice"] as const,
  /** The person's own working preferences. */
  preferences: ["preferences"] as const,
} as const;
