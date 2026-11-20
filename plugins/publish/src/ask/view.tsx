/**
 * The publish screen's own confirmation, asked in the conversation once the person asked there.
 * Each button runs the same action as on the publish screen.
 */
import type { ScreenViewProps } from "@corbits-builder/plugin-ui/screen";
import { ScreenActions } from "@corbits-builder/plugin-ui/screen-actions";
import { ScreenCard } from "@corbits-builder/plugin-ui/screen-card";
import { text as published } from "../published/definition.ts";
import { Fault, Place, Press, TakeDownSure } from "../published/view.tsx";
import { text, type Asked } from "./definition.ts";

type Props = ScreenViewProps<
  Record<string, never>,
  Record<string, never>,
  Asked
>;

export function Ask({ prepared: { data }, act, submitting, fault }: Props) {
  if (data.do === "take-down")
    return (
      <TakeDownSure
        where={data.where}
        act={act}
        submitting={submitting}
        fault={fault}
        keep={null}
      />
    );
  return (
    <ScreenCard
      title={text.publish}
      actions={
        <ScreenActions>
          <Press
            label={published.publish}
            action="publish"
            input={{ plan: data.plan }}
            variant="primary"
            act={act}
            submitting={submitting}
          />
        </ScreenActions>
      }
    >
      <Fault fault={fault} />
      <Place about={data.about} />
    </ScreenCard>
  );
}

export default Ask;
