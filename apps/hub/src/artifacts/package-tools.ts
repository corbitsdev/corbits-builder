import { realpath } from "node:fs/promises";
import { type } from "arktype";
import { defineTool, type BaseEnv } from "@intx/agent/authoring";
import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import type { Deck } from "@corbits/slidedeck";
import { PresenterAssignment } from "@corbits-builder/schemas/artifact";
import { defaultPackageTitle } from "../config/personas.ts";
import { resolveWorkflowProjectScope } from "../workflows/project-scope.ts";
import { workflowHttpJson } from "../workflows/http-json.ts";
import {
  DECK_JSON,
  DECK_PDF,
  DECK_PPTX,
  readCheckedDeck,
} from "./deck-tools.ts";
import { failure, HubArtifactReceipt } from "./tools.ts";

export interface PackageToolEnv extends BaseEnv {
  toolCwd: string;
  capabilities: RuntimeCapabilities;
}

const FilePackageArgs = type({
  "+": "ignore",
  "title?": "string > 0",
});

const PresenterAssignmentReceipt = type({
  "+": "ignore",
  assignment: PresenterAssignment,
});

function deriveDeckTitle(
  deck: Deck,
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
      name: "file_package",
      description: `File the checked deck (${DECK_JSON}, ${DECK_PPTX}, ${DECK_PDF}) for your assignment's audience and pinned sources as the next version of the project's approval_package artifact. Refuses with deck_check_failed unless check_deck passed on the current deck.`,
      inputSchema: { ...FilePackageArgs.toJsonSchema() },
    },
  ];
  return defineTool<PackageToolEnv>({
    id: "@corbits-builder/artifacts/package-tools",
    credentials: [{ handle: HUB_CREDENTIAL_HANDLE }],
    requires: ["toolCwd", "capabilities"],
    definitions: [{ name: "file_package" }],
    factory: (env) => ({
      definitions,
      run: async (call, signal) => {
        try {
          if (call.name !== "file_package") {
            return {
              callId: call.id,
              content: "unknown_package_tool",
              isError: true,
            };
          }
          const args = FilePackageArgs(
            call.arguments && typeof call.arguments === "object"
              ? call.arguments
              : {},
          );
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
          const checked = await readCheckedDeck(await realpath(env.toolCwd));
          if (!checked.ok) {
            return {
              callId: call.id,
              content: checked.message,
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
            deck: checked.deck,
            pptxBase64: checked.pptxBytes.toString("base64"),
            pdfBase64: checked.pdfBytes.toString("base64"),
          });
          const title = deriveDeckTitle(
            checked.deck,
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
