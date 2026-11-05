import { writerPackage } from "../writer-package.ts";

const writer = writerPackage("product_requirements");
export const { director, historyCompactor, degenerateTurnCompactor } = writer;
export default writer.workflow;
