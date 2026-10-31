import { coderPackage } from "../coder-package.ts";

// The coder a project deploys when its person turned on installing any package without asking.
const coder = await coderPackage("coder-any-package", "allow");
export const { director, historyCompactor, degenerateTurnCompactor } = coder;
export default coder.workflow;
