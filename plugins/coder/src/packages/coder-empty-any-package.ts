import { coderPackage } from "../package.ts";

// The coder of code without a starter, when its person turned on installing any package without
// asking.
const coder = await coderPackage("coder-empty-any-package", "allow", undefined);
export const { director, historyCompactor, degenerateTurnCompactor } = coder;
export default coder.workflow;
