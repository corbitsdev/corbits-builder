import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import {
  Deck,
  DeckError,
  assetKey,
  assetUses,
  checkDeck,
  validateDeck,
  writeDeckPdf,
  writePptx,
  type Assets,
  type Deck as DeckType,
  type DeckIssue,
} from "@corbits/slidedeck";
import { WorkflowProjectScope } from "@corbits-builder/schemas/installed-workflows";
import { defineTool, type BaseEnv } from "@intx/agent/authoring";
import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import { workflowHttpJson } from "../workflows/http-json.ts";
import { HubArtifactReceipt } from "./tools.ts";

interface DeckToolEnv extends BaseEnv {
  toolCwd: string;
  capabilities?: RuntimeCapabilities;
}

const HubProjectScope = WorkflowProjectScope.onDeepUndeclaredKey("ignore");

export const DECK_JSON = ".builder/deck.json";
export const DECK_PPTX = ".builder/deck.pptx";
export const DECK_PDF = ".builder/deck.pdf";

async function resolveWorkspaceAssets(
  workspace: string,
  deck: DeckType,
  provided?: Assets,
): Promise<Assets> {
  const merged = new Map<string, Uint8Array<ArrayBuffer>>(provided);
  const root = await realpath(workspace);
  for (const { ref } of assetUses(deck)) {
    const key = assetKey(ref);
    if (merged.has(key) || !("path" in ref)) continue;
    const candidate = resolve(root, ref.path);
    if (!candidate.startsWith(root + sep)) continue;
    try {
      const target = await realpath(candidate);
      if (!target.startsWith(root + sep)) continue;
      const bytes = await readFile(target);
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      merged.set(key, copy);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "EISDIR" && code !== "ENOTDIR")
        throw error;
    }
  }
  return merged;
}

export async function writeDeckToWorkspace(
  workspace: string,
  deckInput: unknown,
  assets?: Assets,
) {
  const validated = validateDeck(deckInput);
  if (!validated.ok) throw new DeckError(validated.issues);
  const { deck } = validated;
  const resolvedAssets = await resolveWorkspaceAssets(workspace, deck, assets);
  const issues = checkDeck(deck, resolvedAssets);
  if (issues.length > 0) throw new DeckError(issues);
  const pptx = await writePptx(deck, resolvedAssets);
  const pdf = writeDeckPdf(deck, resolvedAssets);

  const jsonTarget = join(workspace, DECK_JSON);
  await mkdir(dirname(jsonTarget), { recursive: true });
  await writeFile(jsonTarget, `${JSON.stringify(deck, null, 2)}\n`, "utf8");
  await writeFile(join(workspace, DECK_PPTX), pptx);
  await writeFile(join(workspace, DECK_PDF), pdf);

  return {
    deck,
    slideCount: deck.slides.length,
    pptxBytes: pptx.byteLength,
    pdfBytes: pdf.byteLength,
    passed: issues.length === 0,
    issues,
  };
}

export async function checkDeckInWorkspace(workspace: string, assets?: Assets) {
  const raw = await readFile(join(workspace, DECK_JSON), "utf8");
  const parsed: unknown = JSON.parse(raw);
  const validated = validateDeck(parsed);
  if (!validated.ok) {
    return {
      passed: false,
      issues: validated.issues,
    };
  }
  const resolvedAssets = await resolveWorkspaceAssets(
    workspace,
    validated.deck,
    assets,
  );
  const issues = checkDeck(validated.deck, resolvedAssets);
  if (issues.length > 0) {
    return {
      passed: false,
      issues,
    };
  }
  const pptx = await writePptx(validated.deck, resolvedAssets);
  const pdf = writeDeckPdf(validated.deck, resolvedAssets);
  await writeFile(join(workspace, DECK_PPTX), pptx);
  await writeFile(join(workspace, DECK_PDF), pdf);
  return {
    passed: true,
    issues,
  };
}

function deckTitle(deck: DeckType): string {
  for (const slide of deck.slides) {
    if ("title" in slide && typeof slide.title === "string") {
      const trimmed = slide.title.trim();
      if (trimmed.length > 0) return trimmed.slice(0, 512);
    }
  }
  return "Slide deck";
}

export async function fileCheckedDeck(
  workspace: string,
  capabilities: RuntimeCapabilities,
  signal: AbortSignal,
) {
  const [rawDeck, pptxBytes, pdfBytes] = await Promise.all([
    readFile(join(workspace, DECK_JSON), "utf8"),
    readFile(join(workspace, DECK_PPTX)),
    readFile(join(workspace, DECK_PDF)),
  ]);
  const parsed: unknown = JSON.parse(rawDeck);
  const validated = validateDeck(parsed);
  if (!validated.ok) throw new DeckError(validated.issues);
  const content = JSON.stringify({
    deck: validated.deck,
    pptxBase64: Buffer.from(pptxBytes).toString("base64"),
    pdfBase64: Buffer.from(pdfBytes).toString("base64"),
  });
  const scope = HubProjectScope.assert(
    await workflowHttpJson({
      capabilities,
      handle: HUB_CREDENTIAL_HANDLE,
      path: "/api/workflow-project-scope",
      maxResponseBytes: 16384,
      signal,
    }),
  );
  const projectPath =
    "/api/tenants/" +
    encodeURIComponent(scope.tenantId) +
    "/projects/" +
    encodeURIComponent(scope.projectId);
  const { artifact } = HubArtifactReceipt.assert(
    await workflowHttpJson({
      capabilities,
      handle: HUB_CREDENTIAL_HANDLE,
      path: projectPath + "/artifacts",
      body: {
        kind: "deck",
        title: deckTitle(validated.deck),
        content,
      },
      maxResponseBytes: 16384,
      signal,
    }),
  );
  return artifact;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorIssues(path: string, error: unknown): DeckIssue[] {
  if (error instanceof DeckError) return error.issues;
  return [
    {
      path,
      message: error instanceof Error ? error.message : String(error),
    },
  ];
}

export function createDeckTools(assets?: Assets) {
  const definitions = [
    {
      name: "write_deck",
      description:
        "Validate, check and render a slide deck to .builder/deck.json, .builder/deck.pptx and .builder/deck.pdf in the workspace.",
      inputSchema: {
        type: "object",
        properties: {
          deck: {
            ...Deck.toJsonSchema({
              fallback: { default: (ctx) => ctx.base },
            }),
          },
        },
        required: ["deck"],
        additionalProperties: false,
      },
    },
    {
      name: "check_deck",
      description:
        "Check .builder/deck.json in the workspace for empty placeholders, text overflow, broken images and low contrast.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  ];

  return defineTool<DeckToolEnv>({
    id: "@corbits-builder/artifacts/deck-tools",
    credentials: [{ handle: HUB_CREDENTIAL_HANDLE }],
    requires: ["toolCwd"],
    definitions: [{ name: "write_deck" }, { name: "check_deck" }],
    factory: (env) => ({
      definitions,
      run: async (call, signal) => {
        if (call.name === "write_deck") {
          const deckArg =
            isObjectRecord(call.arguments) && "deck" in call.arguments
              ? call.arguments.deck
              : call.arguments;
          try {
            const written = await writeDeckToWorkspace(
              env.toolCwd,
              deckArg,
              assets,
            );
            return {
              callId: call.id,
              content: JSON.stringify({
                slideCount: written.slideCount,
                pptxBytes: written.pptxBytes,
                pdfBytes: written.pdfBytes,
                passed: written.passed,
                issues: written.issues,
              }),
            };
          } catch (error) {
            return {
              callId: call.id,
              content: JSON.stringify({
                passed: false,
                issues: errorIssues("deck", error),
              }),
              isError: true,
            };
          }
        }

        if (call.name === "check_deck") {
          try {
            const checked = await checkDeckInWorkspace(env.toolCwd, assets);
            if (!checked.passed) {
              return {
                callId: call.id,
                content: JSON.stringify(checked),
                isError: true,
              };
            }
            const artifact = env.capabilities
              ? await fileCheckedDeck(env.toolCwd, env.capabilities, signal)
              : undefined;
            return {
              callId: call.id,
              content: JSON.stringify({
                ...checked,
                ...(artifact ? { artifact } : {}),
              }),
            };
          } catch (error) {
            return {
              callId: call.id,
              content: JSON.stringify({
                passed: false,
                issues: errorIssues(DECK_JSON, error),
              }),
              isError: true,
            };
          }
        }

        return {
          callId: call.id,
          content: "unknown_deck_tool",
          isError: true,
        };
      },
    }),
  });
}
