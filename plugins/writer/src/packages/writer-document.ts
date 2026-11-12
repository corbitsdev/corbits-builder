import { writerPackage } from "../package.ts";

const writer = writerPackage();
export const { director, historyCompactor, degenerateTurnCompactor } = writer;
export default writer.workflow;
