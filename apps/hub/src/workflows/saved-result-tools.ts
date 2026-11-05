import { defineTool } from "@intx/agent/authoring";
import { createPosixTools, TOOL_NAMES } from "@intx/tools-posix";
import { createBlobReader } from "@intx/types/runtime";

const SAVED_RESULT = "tool-output://";

// Named read_file because the trimming note and Interchange's size-cap note both tell the agent to
// read_file a tool-output:/// URI. It reads only those URIs, so an agent without a workspace gets no
// file access from it; the workdir is a required cwd that is never read.
export const savedResultTools = defineTool({
  id: "@corbits-builder/saved-result/tools",
  definitions: [{ name: TOOL_NAMES.READ_FILE }],
  factory: (env) => {
    const posix = createPosixTools({
      cwd: env.workdir,
      blobReader: createBlobReader(env.storage),
    });
    return {
      definitions: [
        {
          name: TOOL_NAMES.READ_FILE,
          description:
            "Read back the whole of an earlier tool result that was trimmed or cut short, with line numbers. Pass the tool-output:///... URI its note gives.",
          inputSchema: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "The tool-output:///... URI the note gives",
              },
              offset: {
                type: "number",
                description: "Zero-based line offset to start reading from",
              },
              limit: {
                type: "number",
                description: "Maximum number of lines to return",
              },
            },
            required: ["path"],
          },
        },
      ],
      run: async (call, signal) => {
        const path = call.arguments["path"];
        if (typeof path !== "string" || !path.startsWith(SAVED_RESULT))
          return {
            callId: call.id,
            content:
              "read_file here reads only a saved result: pass the tool-output:///... URI its note gives.",
            isError: true,
          };
        // Models drop a slash from tool-output:///<callId> and retry it verbatim, and the URI parser
        // reads the callId after two slashes as a host.
        const uri = path.startsWith(`${SAVED_RESULT}/`)
          ? path
          : path.replace(SAVED_RESULT, `${SAVED_RESULT}/`);
        return posix.run(
          { ...call, arguments: { ...call.arguments, path: uri } },
          signal,
        );
      },
    };
  },
});
