/**
 * Connecting a model provider as it looks: a tile per subscription login, then
 * a tile per API-key provider, on the screen before the project list and in
 * the dialog over an open project.
 */
import { productName, wording } from "../config.ts";
import { AuthLayout, DitherCanvas, KindCardGrid } from "@corbits/react-ui";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@corbits/react-ui/ui/dialog";
import { Banner, Mark, QuietButton } from "../components.jsx";
import { ProviderLogo } from "./settings/provider-logos.tsx";
import styles from "./model-setup.module.css";

const copy = wording.providers;

/** A provider as its tile shows it. */
export type ProviderTile = { id: string; label: string; hint: string };

export type ProviderTilesProps = {
  /** Why the providers could not be read; it stands above whatever tiles the last read left. */
  fault: string | null;
  /** The providers to connect, by how each connects; null until they have been read. */
  tiles: {
    logins: readonly ProviderTile[];
    apiKeys: readonly ProviderTile[];
  } | null;
  /** The login whose sign-in is in flight; every tile waits until it ends. */
  signingIn: string | null;
  onSignIn: (id: string) => void;
  onAddKey: (id: string) => void;
};

function ProviderTiles({
  fault,
  tiles,
  signingIn,
  onSignIn,
  onAddKey,
}: ProviderTilesProps) {
  const banner = fault === null ? null : <Banner tone="error" title={fault} />;
  if (tiles === null) return banner;
  return (
    <>
      {banner}
      <KindCardGrid
        label={copy.loginGroup}
        className={styles.tiles}
        options={tiles.logins.map((provider) => ({
          id: provider.id,
          title: provider.label,
          description: signingIn === provider.id ? copy.waiting : provider.hint,
          icon: <ProviderLogo providerId={provider.id} />,
          disabled: signingIn !== null,
        }))}
        onChange={onSignIn}
      />
      <hr className={styles.divider} />
      <KindCardGrid
        label={copy.apiKeyGroup}
        className={styles.tiles}
        options={tiles.apiKeys.map((provider) => ({
          id: provider.id,
          title: provider.label,
          description: provider.hint,
          icon: <ProviderLogo providerId={provider.id} />,
          disabled: signingIn !== null,
        }))}
        onChange={onAddKey}
      />
    </>
  );
}

export type ModelSetupViewProps = {
  providers: ProviderTilesProps;
  onLater: () => void;
};

export function ModelSetupView({ providers, onLater }: ModelSetupViewProps) {
  return (
    <AuthLayout
      brand={
        <>
          <Mark size={22} />
          <span>{productName}</span>
        </>
      }
      panel={<DitherCanvas />}
    >
      <div className={styles.setup}>
        <hgroup>
          <h1>{copy.connect}</h1>
          <p>{copy.noneHint}</p>
        </hgroup>
        <ProviderTiles {...providers} />
        <div className={styles.later}>
          <QuietButton onClick={onLater}>
            {wording.action.skipForNow}
          </QuietButton>
          <p>{copy.addLater}</p>
        </div>
      </div>
    </AuthLayout>
  );
}

export type EnableAiDialogViewProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providers: ProviderTilesProps;
};

export function EnableAiDialogView({
  open,
  onOpenChange,
  providers,
}: EnableAiDialogViewProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.connect}</DialogTitle>
          <DialogDescription>{copy.noneHint}</DialogDescription>
        </DialogHeader>
        <DialogBody className={styles.setup}>
          <ProviderTiles {...providers} />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
