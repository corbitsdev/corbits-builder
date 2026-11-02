import { useState } from "react";
import { Button as UiButton } from "@corbits/react-ui";
import type {
  ModelCatalog,
  ModelChoice,
  ModelProvider,
} from "@corbits-builder/schemas/models";
import type { FailedRun } from "@corbits-builder/schemas/artifact";
import type {
  ConversationEvent,
  ConversationTurn,
} from "../../api/conversation.ts";
import { wording } from "../../config.ts";
import { profileOptions, refusedProviderFor } from "../profile-select.tsx";
import { AddProviderDialog, useSubscriptionLogins } from "../providers.tsx";
import { isCredentialFailureText } from "./visible-chat.ts";

export type CredentialRecoveryState = {
  readonly at: number;
  readonly retryMessage: string;
  readonly provider?: ModelProvider;
  readonly alternatives: readonly {
    readonly id: string;
    readonly label: string;
  }[];
};

function latestSuccessfulAssistantAt(
  turns: readonly ConversationTurn[],
): number {
  let latest = 0;
  for (const turn of turns) {
    if (
      turn.role === "assistant" &&
      !isCredentialFailureText(turn.text) &&
      turn.at > latest
    ) {
      latest = turn.at;
    }
  }
  return latest;
}

function latestCredentialFailureAt(input: {
  readonly turns: readonly ConversationTurn[];
  readonly failed: readonly FailedRun[] | undefined;
  readonly events: readonly ConversationEvent[] | null;
  readonly liveCredentialFailed: boolean;
  readonly liveEndedAt: number | null;
}): number | null {
  let latest: number | null = null;
  for (const turn of input.turns) {
    if (
      isCredentialFailureText(turn.text) &&
      (latest === null || turn.at > latest)
    ) {
      latest = turn.at;
    }
  }
  if (input.failed !== undefined) {
    for (const run of input.failed) {
      const message = run.error?.message;
      if (message !== undefined && isCredentialFailureText(message)) {
        const parsed = Date.parse(run.endedAt);
        const at = Number.isNaN(parsed) ? 1 : parsed;
        if (latest === null || at > latest) latest = at;
      }
    }
  }
  if (input.events !== null) {
    for (const event of input.events) {
      if (event.type === "StepFailed" || event.type === "RunFailed") {
        const detail = event.body["message"];
        if (typeof detail === "string" && isCredentialFailureText(detail)) {
          const at = event.seq;
          if (latest === null || at > latest) latest = at;
        }
      }
    }
  }
  if (input.liveCredentialFailed) {
    const at = input.liveEndedAt ?? Date.now();
    if (latest === null || at > latest) latest = at;
  }
  return latest;
}

function retryMessageFor(
  turns: readonly ConversationTurn[],
  failureAt: number,
): string {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]!;
    if (turn.role !== "person" || turn.at > failureAt) continue;
    const text = turn.text.trim();
    if (text.length === 0) continue;
    const answered = turns
      .slice(index + 1)
      .some(
        (later) =>
          later.role === "assistant" && !isCredentialFailureText(later.text),
      );
    if (!answered) return text;
    break;
  }
  return wording.credentials.continueMessage;
}

function resolveFailingProvider(
  catalog: ModelCatalog | undefined,
  choice: ModelChoice | null | undefined,
): ModelProvider | undefined {
  if (!catalog) return undefined;
  const refused = refusedProviderFor(catalog, choice, false);
  if (refused) return refused;
  const activeId = choice?.profile ?? catalog.automaticProfile;
  if (activeId) {
    const profile =
      choice?.custom?.find((entry) => entry.id === activeId) ??
      catalog.profiles.find((entry) => entry.id === activeId);
    if (profile) {
      const provider = catalog.providers.find(
        (entry) => entry.id === profile.tiers.medium.provider,
      );
      if (provider) return provider;
    }
  }
  return catalog.providers.find((provider) =>
    provider.connections.some((conn) => conn.credentialSet),
  );
}

export function resolveCredentialRecovery(input: {
  readonly turns: readonly ConversationTurn[];
  readonly failed: readonly FailedRun[] | undefined;
  readonly events: readonly ConversationEvent[] | null;
  readonly liveCredentialFailed: boolean;
  readonly liveEndedAt: number | null;
  readonly dismissedAt: number;
  readonly catalog: ModelCatalog | undefined;
  readonly choice: ModelChoice | null | undefined;
}): CredentialRecoveryState | null {
  const refusedProvider = refusedProviderFor(
    input.catalog,
    input.choice,
    false,
  );
  const failureAt = latestCredentialFailureAt(input);
  if (failureAt === null) return null;
  if (failureAt <= latestSuccessfulAssistantAt(input.turns)) return null;
  if (failureAt <= input.dismissedAt) return null;
  const provider =
    refusedProvider ?? resolveFailingProvider(input.catalog, input.choice);
  const activeProfileId =
    input.choice?.profile ?? input.catalog?.automaticProfile;
  const alternatives: { readonly id: string; readonly label: string }[] = [];
  if (input.catalog) {
    for (const option of profileOptions(input.catalog, input.choice ?? null)) {
      if (provider) {
        const profile =
          input.choice?.custom?.find((entry) => entry.id === option.id) ??
          input.catalog.profiles.find((entry) => entry.id === option.id);
        if (
          profile &&
          Object.values(profile.tiers).some(
            (binding) => binding.provider === provider.id,
          )
        )
          continue;
      }
      if (option.id !== activeProfileId) {
        alternatives.push({ id: option.id, label: option.name });
      }
    }
  }
  let retryProvider: { readonly provider: ModelProvider } | undefined;
  if (provider !== undefined) retryProvider = { provider };
  return {
    at: failureAt,
    retryMessage: retryMessageFor(input.turns, failureAt),
    ...retryProvider,
    alternatives,
  };
}

export function CredentialRecoveryBanner({
  recovery,
  busy,
  onReconnected,
  onSwitchProfile,
}: {
  recovery: CredentialRecoveryState;
  busy: boolean;
  onReconnected: () => void;
  onSwitchProfile: (profileId: string) => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { signingIn, signIn } = useSubscriptionLogins(onReconnected);
  const provider = recovery.provider;
  const isLogin = provider?.kind === "login";

  return (
    <div className="banner" role="alert">
      <p className="banner-title">
        {wording.credentials.bannerTitle(provider?.label)}
      </p>
      <p>{wording.credentials.bannerLead(provider?.label)}</p>
      <div className="banner-action">
        {isLogin && provider ? (
          <UiButton
            type="button"
            size="sm"
            disabled={busy || signingIn !== null}
            onClick={() => void signIn(provider)}
          >
            {signingIn === provider.id
              ? wording.providers.waiting
              : wording.credentials.reconnect(provider.label)}
          </UiButton>
        ) : (
          <UiButton
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => setDialogOpen(true)}
          >
            {wording.credentials.readdKey(provider?.label)}
          </UiButton>
        )}
        {recovery.alternatives.map((alternative) => (
          <UiButton
            key={alternative.id}
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onSwitchProfile(alternative.id)}
          >
            {busy
              ? wording.credentials.switching
              : wording.credentials.switchTo(alternative.label)}
          </UiButton>
        ))}
      </div>
      {isLogin ? null : (
        <AddProviderDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          providerId={provider?.kind === "api_key" ? provider.id : undefined}
          onConnected={onReconnected}
        />
      )}
    </div>
  );
}
