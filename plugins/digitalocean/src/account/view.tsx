/**
 * The person picks a size for the server Builder makes at DigitalOcean, each size with its monthly
 * price, and a region, then signs in and picks the team that pays. Signing in answers the screen
 * with the choice and the sign-in's team. Once a server exists and costs money, the screen only
 * signs them in again, with a warning that disconnecting does not stop the server.
 */
import { useState } from "react";
import type { HttpCredentialDeclaration } from "@corbits-builder/plugin";
import {
  ChoiceSegments,
  RadioGroup,
} from "@corbits-builder/plugin-ui/choice-segments";
import { ownCredential } from "@corbits-builder/plugin-ui/credentials";
import type { ScreenViewProps } from "@corbits-builder/plugin-ui/screen";
import {
  ScreenCard,
  ScreenSettled,
} from "@corbits-builder/plugin-ui/screen-card";
import { SignInForm } from "@corbits-builder/plugin-ui/sign-in-form";
import manifest from "../../package.json";
import { CREDENTIAL, REGIONS } from "../target.ts";
import { text, type Output, type Prepared } from "./definition.ts";
import styles from "./view.module.css";

type Props = ScreenViewProps<
  Record<string, never>,
  Output,
  Prepared,
  { tenants: { project: string; workspace: string } }
>;

const declaration: HttpCredentialDeclaration = {
  ...manifest.builder.credentials[CREDENTIAL],
  sends: "bearer",
};

const SIZE_LOOK = {
  slot: "digitalocean-sizes",
  group: styles.sizes,
  option: styles.size,
};

// The team the project's sign-in bills, as the hub stored it from DigitalOcean's answer.
async function signedInTeam(project: string) {
  const metadata = (await ownCredential(project, CREDENTIAL))?.metadata;
  const id = metadata?.["accountId"];
  const name = metadata?.["account"];
  if (typeof id !== "string" || id === "") return undefined;
  return typeof name === "string" && name !== "" ? { id, name } : { id };
}

export function AccountScreen({
  prepared: { data, resources },
  submit,
  submitting,
  answer,
}: Props) {
  const [size, setSize] = useState(data.mode === "choose" ? data.size : "");
  const [region, setRegion] = useState(
    data.mode === "choose" ? data.region : "",
  );
  const [fault, setFault] = useState<string>();
  if (answer !== undefined)
    return <ScreenSettled asked={text.title} answer={text.settled(answer)} />;
  const project = resources.tenants.project;
  if (data.mode === "signIn")
    return (
      <ScreenCard title={text.title}>
        <p className={styles.about}>{text.signedOut}</p>
        <SignInForm
          name={CREDENTIAL}
          declaration={declaration}
          tenants={{ project }}
          warning={text.warning(data.costs)}
          onSaved={() => void submit({ signedIn: true })}
        />
      </ScreenCard>
    );
  const sizes = data.sizes;
  const chosen = sizes.find((offer) => offer.slug === size) ?? sizes[0]!;
  const place = REGIONS.find((each) => each.slug === region) ?? REGIONS[0];
  const signedIn = async () => {
    setFault(undefined);
    const team = await signedInTeam(project).catch((cause: unknown) => {
      if (!(cause instanceof Error)) throw cause;
      return undefined;
    });
    if (team === undefined) {
      setFault(text.noTeam);
      return;
    }
    await submit({
      size: chosen.slug,
      region: place.slug,
      monthly: chosen.monthly,
      team,
    });
  };
  return (
    <ScreenCard title={text.title}>
      <div className={styles.choices} data-slot="digitalocean-account">
        <p className={styles.about}>{text.about}</p>
        <section className={styles.choice}>
          <h3 className={styles.heading}>{text.size}</h3>
          <RadioGroup
            label={text.size}
            options={sizes.map((offer) => ({
              id: offer.slug,
              label: text.sizeLabel(offer),
            }))}
            choice={chosen.slug}
            onChoose={setSize}
            disabled={submitting}
            look={SIZE_LOOK}
          >
            {(option) => <span className={styles.label}>{option.label}</span>}
          </RadioGroup>
          <p className={styles.hint}>{text.smallest}</p>
        </section>
        <section className={styles.choice}>
          <h3 className={styles.heading}>{text.region}</h3>
          <ChoiceSegments
            label={text.region}
            options={REGIONS.map((each) => ({
              id: each.slug,
              label: each.city,
            }))}
            choice={place.slug}
            onChoose={setRegion}
            disabled={submitting}
          />
          <p className={styles.hint}>{text.regionHint}</p>
        </section>
        {fault === undefined ? null : (
          <p className={styles.fault} role="alert">
            {fault}
          </p>
        )}
        <SignInForm
          name={CREDENTIAL}
          declaration={declaration}
          tenants={{ project }}
          onSaved={() => void signedIn()}
        />
      </div>
    </ScreenCard>
  );
}

export default AccountScreen;
