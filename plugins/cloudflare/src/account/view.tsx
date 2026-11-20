/**
 * Offers two accounts to publish to Cloudflare with: a temporary one once the person accepts
 * Cloudflare's terms, or their own through a token they save. The temporary account comes first as
 * the primary choice, unless the app is in a temporary account Builder made that the person can
 * still keep. Then changes go out by keeping it and adding their token, so their own account comes
 * first. Publishing without an account is the card's action, so it never scrolls out of reach;
 * saving a token answers from the token form. Once the person agreed to take the app down, the
 * screen asks only for a token for the account the app is in.
 */
import { useId, useState, type ReactNode } from "react";
import { Button, Checkbox } from "@corbits/react-ui";
import type { HttpCredentialDeclaration } from "@corbits-builder/plugin";
import { CredentialForm } from "@corbits-builder/plugin-ui/credential-form";
import type { ScreenViewProps } from "@corbits-builder/plugin-ui/screen";
import { ScreenActions } from "@corbits-builder/plugin-ui/screen-actions";
import {
  ScreenCard,
  ScreenSettled,
} from "@corbits-builder/plugin-ui/screen-card";
import manifest from "../../package.json";
import { CREDENTIAL } from "../target.ts";
import { text, type Output, type Prepared } from "./definition.ts";
import styles from "./view.module.css";

type Props = ScreenViewProps<
  Record<string, never>,
  typeof Output.infer,
  Prepared,
  { tenants: { project: string; workspace: string } }
>;

const declaration: HttpCredentialDeclaration = {
  ...manifest.builder.credentials[CREDENTIAL],
  sends: "bearer",
};

export function AccountScreen({
  prepared: { data, resources },
  submit,
  submitting,
  answer,
}: Props) {
  const id = useId();
  const [accepted, setAccepted] = useState(false);
  if (answer !== undefined)
    return (
      <ScreenSettled
        asked={
          answer.account === "own" && answer.takeDown === true
            ? text.takeDown.title
            : text.title
        }
        answer={text.settled[answer.account]}
      />
    );
  const takingDown = data.mode === "takeDown";
  const title = takingDown ? text.takeDown.title : text.title;
  const tokenForm = (
    <CredentialForm
      name={CREDENTIAL}
      declaration={declaration}
      tenants={resources.tenants}
      onSaved={() =>
        void submit(
          takingDown
            ? { account: "own", saved: true, takeDown: true }
            : { account: "own", saved: true },
        )
      }
    />
  );
  if (takingDown)
    return (
      <ScreenCard title={title}>
        <div className={styles.account} data-slot="cloudflare-take-down">
          <p className={styles.lead}>
            {data.unkept === undefined
              ? text.takeDown.about
              : data.unkept.passed
                ? text.takeDown.passed(data.unkept.until)
                : text.takeDown.pending(data.unkept.until)}
          </p>
          <p className={styles.about}>{text.own.about}</p>
          {tokenForm}
        </div>
      </ScreenCard>
    );
  const keepable = data.temporary === "keepable";
  const temporary = (
    <section
      className={styles.account}
      data-slot="cloudflare-temporary"
      key="temporary"
    >
      <h3 className={styles.heading}>{text.temporary.heading}</h3>
      <p className={styles.about}>{text.temporary.about}</p>
      <div className={styles.consent}>
        <Checkbox
          id={id}
          checked={accepted}
          onCheckedChange={(checked) => setAccepted(checked === true)}
        />
        <label htmlFor={id} className={styles.label}>
          {text.temporary.acceptBefore}
          <Document href={text.terms.href}>{text.temporary.terms}</Document>
          {text.temporary.and}
          <Document href={text.privacy.href}>{text.temporary.privacy}</Document>
        </label>
      </div>
    </section>
  );
  const own = (
    <section className={styles.account} data-slot="cloudflare-own" key="own">
      <h3 className={styles.heading}>{text.own.heading}</h3>
      <p className={styles.about}>{text.own.about}</p>
      {tokenForm}
    </section>
  );
  return (
    <ScreenCard
      title={title}
      // The body can scroll past the card's height; this action stays visible below it.

      actions={
        <ScreenActions>
          <Button
            type="button"
            size="sm"
            variant={keepable ? "outline" : "primary"}
            disabled={!accepted || submitting}
            onClick={() =>
              void submit({ account: "temporary", accepted: true })
            }
          >
            {text.temporary.go}
          </Button>
        </ScreenActions>
      }
    >
      {data.temporary === "none" ? null : (
        <p className={styles.already}>{text.already[data.temporary]}</p>
      )}
      <div className={styles.accounts} data-slot="cloudflare-account">
        {keepable ? [own, temporary] : [temporary, own]}
      </div>
    </ScreenCard>
  );
}

function Document({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      className={styles.link}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  );
}

export default AccountScreen;
