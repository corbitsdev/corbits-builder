import type { SshCredentialDeclaration } from "@corbits-builder/plugin";
import type { ScreenViewProps } from "@corbits-builder/plugin-ui/screen";
import {
  ScreenCard,
  ScreenSettled,
} from "@corbits-builder/plugin-ui/screen-card";
import { ServerKeyForm } from "@corbits-builder/plugin-ui/server-key-form";
import manifest from "../../package.json";
import { text } from "./definition.ts";
import styles from "./view.module.css";

type Props = ScreenViewProps<
  Record<string, never>,
  { saved: true },
  Record<string, never>,
  { tenants: { project: string; workspace: string } }
>;

const NAME = "server";
const declaration: SshCredentialDeclaration = {
  ...manifest.builder.credentials[NAME],
  sends: "ssh",
};

export function Connect({ prepared: { resources }, submit, answer }: Props) {
  if (answer !== undefined)
    return <ScreenSettled asked={text.title} answer={text.settled} />;
  return (
    <ScreenCard title={text.title}>
      <p className={styles.about} data-slot="connect-server">
        {text.about}
      </p>
      <ServerKeyForm
        name={NAME}
        declaration={declaration}
        tenants={{ project: resources.tenants.project }}
        onSaved={() => void submit({ saved: true })}
      />
    </ScreenCard>
  );
}

export default Connect;
