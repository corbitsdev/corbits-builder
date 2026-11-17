import { existsSync } from "node:fs";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { defineTool, type BaseEnv } from "@intx/agent/authoring";
import { createPosixTools, TOOL_NAMES } from "@intx/tools-posix";
import { createBlobReader } from "@intx/types/runtime";
import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import { INPUTS_DIRECTORY } from "@corbits-builder/schemas/app-files";
import { HubArtifactList } from "../artifacts/tools.ts";
import { sourceDocument } from "./source-document.ts";
import { workflowHttpJson } from "@corbits-builder/plugin/http-json";
import {
  projectScopeFailure,
  resolveWorkflowProjectScope,
} from "./project-scope.ts";
import { savedResultPath } from "./saved-result-tools.ts";
import {
  ArtifactContent,
  MATERIAL_KIND,
  isDocumentKind,
  type ArtifactListItem,
} from "@corbits-builder/schemas/artifact";

type InputDocument = Pick<ArtifactListItem, "artifactId" | "kind" | "title">;

export function inputFileName(document: InputDocument): string {
  if (document.kind !== MATERIAL_KIND) return document.kind + ".md";
  const title = document.title.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 100);
  return title + "-" + document.artifactId + ".md";
}

const PATH_FAILURE = `read_file here reads a file inside ${INPUTS_DIRECTORY} or a tool-output:///... URI; that path is neither.`;

// The real path of a file inside the inputs folder, or undefined when it is missing or a link
// leads out of the folder.
async function inputPath(
  inputs: string,
  requested: string,
): Promise<string | undefined> {
  if (!existsSync(requested)) return undefined;
  const path = await realpath(requested);
  const location = relative(await realpath(inputs), path);
  if (
    location === ".." ||
    location.startsWith(".." + sep) ||
    isAbsolute(location)
  )
    return undefined;
  return path;
}
interface InputFileEnv extends BaseEnv {
  capabilities: RuntimeCapabilities;
}
async function filedDocuments(
  env: InputFileEnv,
  role: string,
  signal: AbortSignal,
) {
  const scope = await resolveWorkflowProjectScope(
    env.capabilities,
    role,
    signal,
  );
  const list = HubArtifactList.assert(
    await workflowHttpJson({
      capabilities: env.capabilities,
      handle: HUB_CREDENTIAL_HANDLE,
      path:
        "/api/tenants/" +
        encodeURIComponent(scope.tenantId) +
        "/projects/" +
        encodeURIComponent(scope.projectId) +
        "/artifacts",
      maxResponseBytes: Number.POSITIVE_INFINITY,
      signal,
    }),
  );
  return Promise.all(
    list.artifacts
      .filter(
        (item) =>
          isDocumentKind(item.kind) ||
          ["design", MATERIAL_KIND].includes(item.kind),
      )
      .map(async (item) => {
        const document = ArtifactContent.assert(
          await workflowHttpJson({
            capabilities: env.capabilities,
            handle: HUB_CREDENTIAL_HANDLE,
            path:
              "/api/tenants/" +
              encodeURIComponent(scope.tenantId) +
              "/projects/" +
              encodeURIComponent(scope.projectId) +
              "/artifacts/" +
              encodeURIComponent(item.artifactId),
            // A file never enters the model's context whole, so a large document is not refused.
            maxResponseBytes: Number.POSITIVE_INFINITY,
            signal,
          }),
        );
        return { ...item, content: sourceDocument(document).content };
      }),
  );
}
export function createInputFileTools(
  role: string,
  fetchDocuments: (
    env: InputFileEnv,
    signal: AbortSignal,
  ) => Promise<readonly (InputDocument & { content: string })[]> = (
    env,
    signal,
  ) => filedDocuments(env, role, signal),
) {
  return defineTool<InputFileEnv>({
    id: "@corbits-builder/input-file/tools",
    credentials: [{ handle: HUB_CREDENTIAL_HANDLE }],
    requires: ["capabilities"],
    definitions: [
      { name: TOOL_NAMES.READ_FILE },
      { name: TOOL_NAMES.SEARCH_FILES },
    ],
    factory: (env) => {
      const posix = createPosixTools({
        cwd: env.workdir,
        blobReader: createBlobReader(env.storage),
      });
      const inputs = resolve(env.workdir, INPUTS_DIRECTORY);
      let setup: Promise<void> | undefined;
      const place = async (signal: AbortSignal) => {
        const documents = await fetchDocuments(env, signal);
        await mkdir(inputs, { recursive: true });
        for (const document of documents) {
          const name = inputFileName(document);
          await writeFile(resolve(inputs, name), document.content);
        }
      };
      return {
        definitions: posix.definitions
          .filter(
            ({ name }) =>
              name === TOOL_NAMES.READ_FILE || name === TOOL_NAMES.SEARCH_FILES,
          )
          .map((definition) => {
            if (definition.name === TOOL_NAMES.READ_FILE)
              return {
                ...definition,
                description: `Read a document inside ${INPUTS_DIRECTORY} with line numbers, or read back the whole of an earlier tool result that was trimmed or cut short. For a saved result, pass the tool-output:///... URI its note gives.`,
              };
            return {
              ...definition,
              description: `Find files matching a glob pattern inside ${INPUTS_DIRECTORY}.`,
            };
          }),
        run: async (call, signal) => {
          setup ??= place(signal);
          try {
            await setup;
          } catch (error) {
            setup = undefined;
            return projectScopeFailure(call.id, error);
          }
          const at = (path: string) =>
            posix.run(
              { ...call, arguments: { ...call.arguments, path } },
              signal,
            );
          if (call.name === TOOL_NAMES.SEARCH_FILES) return at(inputs);
          const raw = call.arguments["path"];
          const refused = {
            callId: call.id,
            content: PATH_FAILURE,
            isError: true,
          };
          if (typeof raw !== "string") return refused;
          const saved = savedResultPath(raw);
          if (saved) return at(saved);
          // The search tool answers with names inside the inputs folder; the task names paths from
          // the working folder.
          const path = await inputPath(
            inputs,
            raw.startsWith(INPUTS_DIRECTORY + "/")
              ? resolve(env.workdir, raw)
              : resolve(inputs, raw),
          );
          return path === undefined ? refused : at(path);
        },
      };
    },
  });
}
