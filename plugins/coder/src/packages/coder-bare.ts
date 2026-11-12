import { coderPackage } from "../package.ts";

// The coder of anything that is not a web app.
const coder = await coderPackage("coder-bare", "ask", "bare");
export const { director, historyCompactor, degenerateTurnCompactor } = coder;
export default coder.workflow;
