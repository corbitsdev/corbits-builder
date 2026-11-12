import { coderPackage } from "../package.ts";

// The coder of anything that is not a web app, when its person turned on installing any package
// without asking.
const coder = await coderPackage("coder-bare-any-package", "allow", "bare");
export const { director, historyCompactor, degenerateTurnCompactor } = coder;
export default coder.workflow;
