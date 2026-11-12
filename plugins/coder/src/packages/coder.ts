import { coderPackage } from "../package.ts";

const coder = await coderPackage("coder", "ask");
export const { director, historyCompactor, degenerateTurnCompactor } = coder;
export default coder.workflow;
