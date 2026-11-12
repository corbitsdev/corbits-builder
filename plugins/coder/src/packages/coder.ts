import { coderPackage } from "../package.ts";

const coder = await coderPackage("coder", "ask", "web-app");
export const { director, historyCompactor, degenerateTurnCompactor } = coder;
export default coder.workflow;
