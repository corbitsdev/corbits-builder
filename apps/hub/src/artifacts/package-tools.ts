import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type } from "arktype";
import { defineTool, type BaseEnv } from "@intx/agent/authoring";
import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import { Deck, DeckError, validateDeck } from "@corbits/slidedeck";
import { PresenterAssignment } from "@corbits-builder/schemas/artifact";
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
import { parseJson } from "../lib/json.ts";
import { failure, HubArtifactReceipt } from "./tools.ts";

export { DECK_JSON, DECK_PDF, DECK_PPTX };

export interface PackageToolEnv extends BaseEnv {
  toolCwd: string;
  capabilities: RuntimeCapabilities;
}

export const DECK_CHECK = join(".builder", "deck-check.json");

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
});

const PresenterAssignmentReceipt = type({
  "+": "ignore",
  assignment: PresenterAssignment,
});

const WriteDeckArgs = type({
  "+": "ignore",
  deck: Deck,
});

type DeckCheckState = typeof DeckCheckRecord.infer & { checklist: string };

function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

async function recordDeckCheck(
  workspace: string,
  state: DeckCheckState,
): Promise<void> {
  const target = join(workspace, DECK_CHECK);
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
  const recordText = await readTextIfPresent(join(workspace, DECK_CHECK));
  if (recordText === undefined) {
    return {
      ok: false,
      message:
        "deck_check_failed: check_deck has not run on the current deck yet",
    };
  }
  const record = DeckCheckRecord(parseJson(recordText));
  if (record instanceof type.errors) {
    return {
      ok: false,
      message: `deck_check_failed: invalid ${DECK_CHECK} (${record.summary})`,
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
  assignment: PresenterAssignment,
  title: string | undefined,
): string {
  if (title?.trim()) return title.trim();
  const firstSlide = deck.slides[0];
  if (firstSlide && "title" in firstSlide && firstSlide.title.trim()) {
    return firstSlide.title.trim();
  }
  return defaultPackageTitle(assignment.personaLabel);
}

export function createPackageTools() {
  const definitions = [
    {
      name: "write_deck",
      description:
        "Write the slide deck to .builder/deck.json and render .builder/deck.pptx and .builder/deck.pdf.",
      inputSchema: {
        type: "object",
        properties: {
          deck: Deck.toJsonSchema({ fallback: { default: (ctx) => ctx.base } }),
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
        "File the checked deck (.builder/deck.json, .builder/deck.pptx, .builder/deck.pdf) for your assignment's audience and pinned sources as the next version of the project's approval_package artifact. Refuses with deck_check_failed unless check_deck passed on the current deck.",
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
          const validated = validateDeck(parseJson(deckText));
          if (!validated.ok) {
            return {
              callId: call.id,
              content: `deck_check_failed: ${validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`,
              isError: true,
            };
          }
          const projectPath =
            "/api/tenants/" +
            encodeURIComponent(scope.tenantId) +
            "/projects/" +
            encodeURIComponent(scope.projectId);
          const { assignment } = PresenterAssignmentReceipt.assert(
            await workflowHttpJson({
              capabilities: env.capabilities,
              handle: HUB_CREDENTIAL_HANDLE,
              path: projectPath + "/presenter-assignment",
              maxResponseBytes: 65536,
              signal,
            }),
          );
          const content = JSON.stringify({
            manifest: {
              audience: assignment.audience,
              decisionNeeded: assignment.decisionNeeded,
              tone: assignment.tone,
              length: assignment.length,
              sources: assignment.sources,
            },
            deck: validated.deck,
            pptxBase64: pptxBytes.toString("base64"),
            pdfBase64: pdfBytes.toString("base64"),
          });
          const title = deriveDeckTitle(
            validated.deck,
            assignment,
            args.title,
          ).slice(0, 512);
          const { artifact } = HubArtifactReceipt.assert(
            await workflowHttpJson({
              capabilities: env.capabilities,
              handle: HUB_CREDENTIAL_HANDLE,
              path: projectPath + "/artifacts",
              body: {
                kind: "approval_package",
                title,
                content,
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
