import { writerPackage } from "../writer-package.ts";

const writer = writerPackage("constraints");
export const { director, historyCompactor, degenerateTurnCompactor } = writer;
export default writer.workflow;
