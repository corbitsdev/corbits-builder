import { writerPackage } from "../writer-package.ts";

const writer = writerPackage("build_plan");
export const { director, historyCompactor, degenerateTurnCompactor } = writer;
export default writer.workflow;
