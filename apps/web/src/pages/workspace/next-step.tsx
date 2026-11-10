/**
 * Where the project stands and the person's one next step. The line is pinned above the
 * conversation when the person's preference turns it on. `next-step.model.ts` reads the hub and
 * `next-step.view.tsx` draws the line.
 */
import { useNextStepLine, type NextStepLineProps } from "./next-step.model.ts";
import { NextStepLineView } from "./next-step.view.tsx";

export function NextStepLine(props: NextStepLineProps) {
  const line = useNextStepLine(props);
  return line === null ? null : <NextStepLineView {...line} />;
}
