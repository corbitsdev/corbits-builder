import type { ToolResult } from "@intx/types/runtime";
import type { SourceRef } from "@corbits-builder/schemas";
import type { DesignConcept } from "@corbits-builder/schemas/artifact";
import type {
  NativeSpecialistAssignment,
  NativeSpecialistDeployment,
} from "@corbits-builder/schemas/native-specialist";
import type { Preferences } from "@corbits-builder/schemas/preferences";
import type { APPROVABLE } from "./approvals.ts";

// The filed documents a designer or coder workspace is warmed with.
export type InputKind = (typeof APPROVABLE)[number];
export type SpecialistRole = "writer" | "reviewer" | "coder" | "designer";
export type Ref = typeof SourceRef.infer;

// The host's wording and policy the hand-off tools work by, baked into the bundle that carries them.
export interface HandoffConfig {
  // Turns a failure to resolve the run's project into the tool result, so the host keeps its own
  // logging and codes.
  failure: (callId: string, error: unknown) => ToolResult;
  questionsAsked: string;
  defaultStack: string;
  designThemes: readonly { label: string }[];
  designConcepts: readonly { label: string; direction: string }[];
  designConceptAssignment: (concept: DesignConcept) => string;
  designLookIdeas: (ideas: string) => string;
  designerInputs: readonly InputKind[];
  coderInputs: readonly InputKind[];
  startHere: (
    documents: readonly { kind: InputKind; version: number }[],
    design?: number,
  ) => string;
  agentDecidesApprovals: (preferences: Preferences) => boolean;
  asksOpenQuestions: (preferences: Preferences) => boolean;
  designConceptCount: (preferences: Preferences) => number;
  preferenceBlock: (preferences: Preferences, role: SpecialistRole) => string;
  assignmentToWriterMessage: (
    assignment: typeof NativeSpecialistAssignment.infer,
    read: (
      ref: Ref,
    ) => Promise<{ kind: string; title: string; content: string }>,
    current?: Ref,
  ) => Promise<string>;
}

// The project a coordinator run hands work off for, and the specialists it deploys.
export interface HandoffScope {
  tenantId: string;
  projectId: string;
  domain: string;
  workflows: Record<SpecialistRole, NativeSpecialistDeployment>;
  maxResultBytes: number;
}
