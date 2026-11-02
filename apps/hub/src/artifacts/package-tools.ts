import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type } from "arktype";
import { defineTool, type BaseEnv } from "@intx/agent/authoring";
import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import { Deck, DeckError, validateDeck } from "@corbits/slidedeck";
import { defaultPackageTitle } from "../config/personas.ts";
import { resolveWorkflowProjectScope } from "../workflows/project-scope.ts";
import { workflowHttpJson } from "../workflows/http-json.ts";
import {
  DECK_JSON,
  DECK_PDF,
  DECK_PPTX,
  checkDeckInWorkspace,
  writeDeckToWorkspace,
} from "./deck-tools.ts";
import { failure, HubArtifactReceipt } from "./tools.ts";

export { DECK_JSON, DECK_PDF, DECK_PPTX };

export interface PackageToolEnv extends BaseEnv {
  toolCwd: string;
  capabilities: RuntimeCapabilities;
}

export const DECK_CHECK = join(".builder", "deck-check.json");
export const PACKAGE_ASSIGNMENT = join(".builder", "package-assignment.json");

export const PackageSourcePin = type({
  "+": "ignore",
  artifactId: "string > 0",
  kind: "string > 0",
  title: "string > 0",
  version: "number.integer > 0",
  sha256: /^[a-f0-9]{64}$/,
});
export type PackageSourcePin = typeof PackageSourcePin.infer;

export const PackageAssignmentFile = type({
  "+": "ignore",
  "sealed?": "boolean",
  audience: "string > 0",
  decisionNeeded: "string > 0",
  "personaId?": "string > 0",
  "personaLabel?": "string > 0",
  "tone?": "string",
  "length?": "string",
  "title?": "string",
  "summary?": "string",
  sources: PackageSourcePin.array().atLeastLength(1),
});
export type PackageAssignmentFile = typeof PackageAssignmentFile.infer;

const HexSha256 = /^[a-f0-9]{64}$/;

const DeckCheckRecord = type({
  "+": "ignore",
  passed: "boolean",
  sha256: HexSha256,
  pptxSha256: HexSha256,
  pdfSha256: HexSha256,
  "checklist?": "string",
});

const FilePackageArgs = type({
  "+": "ignore",
  "title?": "string > 0",
  "summary?": "string > 0",
  "audience?": "string > 0",
  "decisionNeeded?": "string > 0",
  "tone?": "string > 0",
  "length?": "string > 0",
  "sources?": PackageSourcePin.array().atLeastLength(1),
  "assignment?": PackageAssignmentFile,
});

const WriteDeckArgs = type({
  "+": "ignore",
  deck: Deck,
  "assignment?": PackageAssignmentFile,
});

type DeckCheckState = {
  passed: boolean;
  sha256: string;
  pptxSha256: string;
  pdfSha256: string;
  checklist: string;
};

const deckChecks = new Map<string, DeckCheckState>();

function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

function assignmentsMatch(
  expected: PackageAssignmentFile,
  candidate: {
    audience?: string;
    decisionNeeded?: string;
    sources?: readonly PackageSourcePin[];
  },
): boolean {
  if (
    candidate.audience !== undefined &&
    candidate.audience.trim() !== expected.audience.trim()
  ) {
    return false;
  }
  if (
    candidate.decisionNeeded !== undefined &&
    candidate.decisionNeeded.trim() !== expected.decisionNeeded.trim()
  ) {
    return false;
  }
  if (candidate.sources !== undefined) {
    const expectedKeys = expected.sources.map(
      (s) => `${s.artifactId}:${s.kind}:${String(s.version)}:${s.sha256}`,
    );
    const candidateKeys = candidate.sources.map(
      (s) => `${s.artifactId}:${s.kind}:${String(s.version)}:${s.sha256}`,
    );
    if (
      expectedKeys.length !== candidateKeys.length ||
      expectedKeys.some((key, index) => key !== candidateKeys[index])
    ) {
      return false;
    }
  }
  return true;
}

export async function writePackageAssignment(
  workspace: string,
  assignment: PackageAssignmentFile,
): Promise<void> {
  const checked = PackageAssignmentFile.assert({
    ...assignment,
    sealed: true,
  });
  const target = join(workspace, PACKAGE_ASSIGNMENT);
  const existingText = await readTextIfPresent(target);
  if (existingText !== undefined) {
    const existing = PackageAssignmentFile(JSON.parse(existingText));
    if (
      !(existing instanceof type.errors) &&
      existing.sealed === true &&
      !assignmentsMatch(existing, checked)
    ) {
      throw new Error(
        "invalid_package_assignment: sealed hand-off assignment cannot be overwritten with a different audience or sources",
      );
    }
  }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(checked, null, 2), "utf8");
}

export async function recordDeckCheck(
  workspace: string,
  result: {
    passed: boolean;
    checklist: string;
    sha256?: string;
    pptxSha256?: string;
    pdfSha256?: string;
  },
): Promise<void> {
  const root = await realpath(workspace);
  let sha256 = result.sha256;
  if (!sha256) {
    const rawDeck = await readFile(join(root, DECK_JSON), "utf8");
    sha256 = sha256Hex(rawDeck);
  }
  const pptxBytes = await readBytesIfPresent(join(root, DECK_PPTX));
  const pdfBytes = await readBytesIfPresent(join(root, DECK_PDF));
  const pptxSha256 =
    result.pptxSha256 ?? (pptxBytes ? sha256Hex(pptxBytes) : "0".repeat(64));
  const pdfSha256 =
    result.pdfSha256 ?? (pdfBytes ? sha256Hex(pdfBytes) : "0".repeat(64));
  const state: DeckCheckState = {
    passed: result.passed,
    sha256,
    pptxSha256,
    pdfSha256,
    checklist: result.checklist,
  };
  deckChecks.set(root, state);
  const target = join(root, DECK_CHECK);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(state, null, 2), "utf8");
}

async function readTextIfPresent(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function readBytesIfPresent(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function verifyDeckCheckPassed(
  workspace: string,
  deckJsonText: string,
  pptxBytes: Uint8Array,
  pdfBytes: Uint8Array,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const currentSha = sha256Hex(deckJsonText);
  const currentPptxSha = sha256Hex(pptxBytes);
  const currentPdfSha = sha256Hex(pdfBytes);
  const inMemory = deckChecks.get(workspace);
  const diskText = await readTextIfPresent(join(workspace, DECK_CHECK));
  let diskRecord: typeof DeckCheckRecord.infer | undefined;
  if (diskText !== undefined) {
    try {
      const parsed = DeckCheckRecord(JSON.parse(diskText));
      if (parsed instanceof type.errors) {
        return {
          ok: false,
          message: `deck_check_failed: invalid ${DECK_CHECK} (${parsed.summary})`,
        };
      }
      diskRecord = parsed;
    } catch (error) {
      return {
        ok: false,
        message: `deck_check_failed: invalid ${DECK_CHECK} (${error instanceof Error ? error.message : String(error)})`,
      };
    }
  }
  const record = diskRecord ?? inMemory;
  if (!record) {
    return {
      ok: false,
      message:
        "deck_check_failed: check_deck has not run on the current deck yet",
    };
  }
  if (!record.passed) {
    const suffix = record.checklist ? `\n${record.checklist}` : "";
    return {
      ok: false,
      message: `deck_check_failed: the deck is filed only once check_deck passes.${suffix}`,
    };
  }
  if (record.sha256 !== currentSha) {
    return {
      ok: false,
      message:
        "deck_check_failed: .builder/deck.json changed after check_deck passed; run check_deck again",
    };
  }
  if (record.pptxSha256 !== currentPptxSha) {
    return {
      ok: false,
      message:
        "deck_check_failed: .builder/deck.pptx changed after check_deck passed; run check_deck again",
    };
  }
  if (record.pdfSha256 !== currentPdfSha) {
    return {
      ok: false,
      message:
        "deck_check_failed: .builder/deck.pdf changed after check_deck passed; run check_deck again",
    };
  }
  return { ok: true };
}

async function resolveAssignment(
  workspace: string,
  args: typeof FilePackageArgs.infer,
): Promise<
  | { ok: true; assignment: PackageAssignmentFile }
  | { ok: false; message: string }
> {
  const diskText = await readTextIfPresent(join(workspace, PACKAGE_ASSIGNMENT));
  if (diskText !== undefined) {
    let diskParsed: unknown;
    try {
      diskParsed = JSON.parse(diskText);
    } catch (error) {
      return {
        ok: false,
        message: `invalid_package_assignment: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    const sealed = PackageAssignmentFile(diskParsed);
    if (sealed instanceof type.errors) {
      return {
        ok: false,
        message: `invalid_package_assignment: ${sealed.summary}`,
      };
    }
    if (
      !assignmentsMatch(sealed, {
        ...(args.audience !== undefined ? { audience: args.audience } : {}),
        ...(args.decisionNeeded !== undefined
          ? { decisionNeeded: args.decisionNeeded }
          : {}),
        ...(args.sources !== undefined ? { sources: args.sources } : {}),
      }) ||
      (args.assignment !== undefined &&
        !assignmentsMatch(sealed, args.assignment))
    ) {
      return {
        ok: false,
        message:
          "invalid_package_assignment: audience, decisionNeeded and sources must match the sealed hand-off assignment",
      };
    }
    return {
      ok: true,
      assignment: {
        ...sealed,
        ...(args.title ? { title: args.title } : {}),
        ...(args.summary ? { summary: args.summary } : {}),
      },
    };
  }
  const merged = {
    ...(args.assignment ?? undefined),
    ...(args.audience ? { audience: args.audience } : {}),
    ...(args.decisionNeeded ? { decisionNeeded: args.decisionNeeded } : {}),
    ...(args.tone ? { tone: args.tone } : {}),
    ...(args.length ? { length: args.length } : {}),
    ...(args.title ? { title: args.title } : {}),
    ...(args.summary ? { summary: args.summary } : {}),
    ...(args.sources ? { sources: args.sources } : {}),
  };
  const checked = PackageAssignmentFile(merged);
  if (checked instanceof type.errors) {
    return {
      ok: false,
      message: `invalid_package_assignment: ${checked.summary}`,
    };
  }
  return { ok: true, assignment: checked };
}

async function runWriteDeck(
  workspace: string,
  callId: string,
  rawArgs: unknown,
) {
  const input = WriteDeckArgs(rawArgs);
  if (input instanceof type.errors) {
    return {
      callId,
      content: `invalid_deck: ${input.summary}`,
      isError: true,
    };
  }
  try {
    if (input.assignment) {
      await writePackageAssignment(workspace, input.assignment);
    }
    const written = await writeDeckToWorkspace(workspace, input.deck);
    return {
      callId,
      content: JSON.stringify({
        slides: written.slideCount,
        deckPath: DECK_JSON,
        pptxPath: DECK_PPTX,
        pdfPath: DECK_PDF,
        passed: written.passed,
        issues: written.issues,
      }),
      ...(written.passed ? {} : { isError: true }),
    };
  } catch (error) {
    if (error instanceof DeckError) {
      return {
        callId,
        content: `invalid_deck: ${error.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`,
        isError: true,
      };
    }
    if (
      error instanceof Error &&
      error.message.startsWith("invalid_package_assignment:")
    ) {
      return {
        callId,
        content: error.message,
        isError: true,
      };
    }
    throw error;
  }
}

async function runCheckDeck(workspace: string, callId: string) {
  const deckText = await readTextIfPresent(join(workspace, DECK_JSON));
  const pptxBytes = await readBytesIfPresent(join(workspace, DECK_PPTX));
  const pdfBytes = await readBytesIfPresent(join(workspace, DECK_PDF));
  if (!deckText || !pptxBytes?.byteLength || !pdfBytes?.byteLength) {
    return {
      callId,
      content:
        "deck_check_failed: .builder/deck.json, .builder/deck.pptx and .builder/deck.pdf must be written first",
      isError: true,
    };
  }
  const sha256 = sha256Hex(deckText);
  const pptxSha256 = sha256Hex(pptxBytes);
  const pdfSha256 = sha256Hex(pdfBytes);
  let checked: Awaited<ReturnType<typeof checkDeckInWorkspace>>;
  try {
    checked = await checkDeckInWorkspace(workspace);
  } catch (error) {
    return {
      callId,
      content: `deck_check_failed: invalid JSON in ${DECK_JSON} (${error instanceof Error ? error.message : String(error)})`,
      isError: true,
    };
  }
  if (!checked.passed) {
    const checklist = checked.issues
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join("\n");
    await recordDeckCheck(workspace, {
      passed: false,
      sha256,
      pptxSha256,
      pdfSha256,
      checklist,
    });
    return {
      callId,
      content: `deck_check_failed:\n${checklist}`,
      isError: true,
    };
  }
  const checklist = `check passed: verified ${DECK_JSON}, ${DECK_PPTX} and ${DECK_PDF}.`;
  await recordDeckCheck(workspace, {
    passed: true,
    sha256,
    pptxSha256,
    pdfSha256,
    checklist,
  });
  return { callId, content: checklist };
}

function deriveDeckTitle(
  deck: typeof Deck.infer,
  assignment: PackageAssignmentFile,
): string {
  if (assignment.title?.trim()) return assignment.title.trim();
  const firstSlide = deck.slides[0];
  if (firstSlide && "title" in firstSlide && firstSlide.title.trim()) {
    return firstSlide.title.trim();
  }
  const label = assignment.personaLabel ?? assignment.audience;
  return defaultPackageTitle(label);
}

export function createPackageTools() {
  const definitions = [
    {
      name: "write_deck",
      description:
        "Write the slide deck to .builder/deck.json, render .builder/deck.pptx and .builder/deck.pdf, and optionally record .builder/package-assignment.json.",
      inputSchema: {
        type: "object",
        properties: {
          deck: Deck.toJsonSchema({ fallback: { default: (ctx) => ctx.base } }),
          assignment: { ...PackageAssignmentFile.toJsonSchema() },
        },
        required: ["deck"],
        additionalProperties: false,
      },
    },
    {
      name: "check_deck",
      description:
        "Check .builder/deck.json, .builder/deck.pptx and .builder/deck.pdf for structural and visual validity before filing the approval package.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "file_package",
      description:
        "File the checked deck (.builder/deck.json, .builder/deck.pptx, .builder/deck.pdf) and .builder/package-assignment.json as the next version of the project's approval_package artifact. Refuses with deck_check_failed unless check_deck passed on the current deck.",
      inputSchema: { ...FilePackageArgs.toJsonSchema() },
    },
  ];
  return defineTool<PackageToolEnv>({
    id: "@corbits-builder/artifacts/package-tools",
    credentials: [{ handle: HUB_CREDENTIAL_HANDLE }],
    requires: ["toolCwd", "capabilities"],
    definitions: [
      { name: "write_deck" },
      { name: "check_deck" },
      { name: "file_package" },
    ],
    factory: (env) => ({
      definitions,
      run: async (call, signal) => {
        try {
          const workspace = await realpath(env.toolCwd);
          if (call.name === "write_deck") {
            return await runWriteDeck(workspace, call.id, call.arguments);
          }
          if (call.name === "check_deck") {
            return await runCheckDeck(workspace, call.id);
          }
          if (call.name !== "file_package") {
            return {
              callId: call.id,
              content: "unknown_package_tool",
              isError: true,
            };
          }
          const rawArgs =
            call.arguments && typeof call.arguments === "object"
              ? call.arguments
              : { title: undefined };
          const args = FilePackageArgs(rawArgs);
          if (args instanceof type.errors) {
            return {
              callId: call.id,
              content: `invalid_arguments: ${args.summary}`,
              isError: true,
            };
          }
          const scope = await resolveWorkflowProjectScope(
            env.capabilities,
            "presenter",
            signal,
          );
          const deckText = await readTextIfPresent(join(workspace, DECK_JSON));
          const pptxBytes = await readBytesIfPresent(
            join(workspace, DECK_PPTX),
          );
          const pdfBytes = await readBytesIfPresent(join(workspace, DECK_PDF));
          if (!deckText || !pptxBytes?.byteLength || !pdfBytes?.byteLength) {
            return {
              callId: call.id,
              content:
                "deck_check_failed: .builder/deck.json, .builder/deck.pptx and .builder/deck.pdf must exist before filing",
              isError: true,
            };
          }
          const checkStatus = await verifyDeckCheckPassed(
            workspace,
            deckText,
            pptxBytes,
            pdfBytes,
          );
          if (!checkStatus.ok) {
            return {
              callId: call.id,
              content: checkStatus.message,
              isError: true,
            };
          }
          let parsedDeck: unknown;
          try {
            parsedDeck = JSON.parse(deckText);
          } catch (error) {
            return {
              callId: call.id,
              content: `deck_check_failed: invalid JSON in ${DECK_JSON} (${error instanceof Error ? error.message : String(error)})`,
              isError: true,
            };
          }
          const validated = validateDeck(parsedDeck);
          if (!validated.ok) {
            return {
              callId: call.id,
              content: `deck_check_failed: ${validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`,
              isError: true,
            };
          }
          const resolved = await resolveAssignment(workspace, args);
          if (!resolved.ok) {
            return {
              callId: call.id,
              content: resolved.message,
              isError: true,
            };
          }
          const { assignment } = resolved;
          const pptxBase64 = pptxBytes.toString("base64");
          const pdfBase64 = pdfBytes.toString("base64");
          const sources = assignment.sources.map((source) => ({
            artifactId: source.artifactId,
            kind: source.kind,
            title: source.title,
            version: source.version,
            sha256: source.sha256,
          }));
          const payloadContent = JSON.stringify({
            manifest: {
              audience: assignment.audience,
              decisionNeeded: assignment.decisionNeeded,
              tone: assignment.tone?.trim()
                ? assignment.tone.trim()
                : "concise",
              length: assignment.length?.trim()
                ? assignment.length.trim()
                : "short",
              sources,
            },
            deck: validated.deck,
            pptxBase64,
            pdfBase64,
          });
          const title = deriveDeckTitle(validated.deck, assignment).slice(
            0,
            512,
          );
          const projectPath =
            "/api/tenants/" +
            encodeURIComponent(scope.tenantId) +
            "/projects/" +
            encodeURIComponent(scope.projectId);
          const { artifact } = HubArtifactReceipt.assert(
            await workflowHttpJson({
              capabilities: env.capabilities,
              handle: HUB_CREDENTIAL_HANDLE,
              path: projectPath + "/artifacts",
              body: {
                kind: "approval_package",
                title,
                content: payloadContent,
              },
              maxResponseBytes: 16384,
              signal,
            }),
          );
          return { callId: call.id, content: JSON.stringify(artifact) };
        } catch (error) {
          return failure(call.id, error);
        }
      },
    }),
  });
}
