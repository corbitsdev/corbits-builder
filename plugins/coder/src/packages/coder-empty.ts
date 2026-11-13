import { coderPackage } from "../package.ts";

// The coder of code that starts from an empty project, or was built or imported without a starter.
const coder = await coderPackage("coder-empty", "ask", undefined);
export const { director, historyCompactor, degenerateTurnCompactor } = coder;
export default coder.workflow;
