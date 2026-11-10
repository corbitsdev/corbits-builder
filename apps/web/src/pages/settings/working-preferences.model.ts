/**
 * What the working preferences section does: reads the person's working preferences from the
 * hub's registry, where the hub keeps them and delivers them to every role they apply to, and
 * saves each change as it is made.
 */
import { wording } from "../../config.ts";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { keys } from "../../queries/keys.ts";
import {
  useWorkspaceApprovalsEnabled,
  writeWorkspaceApprovalsEnabled,
  type OnOff,
} from "../../workspace-approvals-setting.ts";
import { productClient } from "../../api/transport.ts";
import { workspaceTenantId } from "../../api/auth.ts";
import type {
  PreferenceRegistry,
  Preferences,
} from "@corbits-builder/schemas/preferences";
import type { WorkingPreferencesViewProps } from "./working-preferences.view.tsx";

export type WorkingPreferencesProps = {
  focusPreference?: string;
  focusSeq?: number;
};

type SaveState = "saving" | "saved" | "failed";

type PreferenceItem = {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly options: readonly { readonly id: string; readonly label: string }[];
  readonly default: string;
};

function mergeExperimentalPreferences(
  loaded: PreferenceRegistry["preferences"] | null,
): readonly PreferenceItem[] {
  if (loaded === null) {
    return wording.settings.preferences.experimental;
  }
  const extras = wording.settings.preferences.experimental.filter(
    (exp) => !loaded.some((item) => item.id === exp.id),
  );
  return [...loaded, ...extras];
}

/** A preference whose only choices are Off and On, shown as a switch. */
function isOnOff(preference: PreferenceItem): boolean {
  return preference.options.map((option) => option.id).join() === "no,yes";
}

function resolvePreferenceChoice(
  preference: PreferenceItem,
  fieldValue: Preferences | null | undefined,
  approvalsEnabled: OnOff,
): string {
  if (preference.id === "experimental_approvals") {
    return approvalsEnabled === "on" ? "yes" : "no";
  }
  return fieldValue?.[preference.id] ?? preference.default;
}

function syncExperimentalPreference(id: string, choice: string): boolean {
  if (id === "experimental_approvals") {
    writeWorkspaceApprovalsEnabled(choice === "yes" ? "on" : "off");
    return true;
  }
  return false;
}

export function useWorkingPreferences({
  focusPreference,
  focusSeq = 0,
}: WorkingPreferencesProps): WorkingPreferencesViewProps {
  const queryClient = useQueryClient();
  const approvalsEnabled = useWorkspaceApprovalsEnabled();
  const [registry, setRegistry] = useState<
    PreferenceRegistry["preferences"] | null
  >(null);
  const [field, setField] = useState<{
    value: Preferences | null;
    version: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [save, setSave] = useState<{ id: string; state: SaveState } | null>(
    null,
  );
  useEffect(() => {
    let cancelled = false;
    async function loadPreferences() {
      try {
        const tenantId = await workspaceTenantId();
        const [read, record] = await Promise.all([
          productClient().preferenceRegistry(tenantId),
          productClient().personalSettings(tenantId),
        ]);
        if (cancelled) return;
        setRegistry(read.preferences);
        const loadedField = record.fields.preferences ?? {
          value: null,
          version: 0,
        };
        setField(loadedField);
        const approvalsVal = loadedField.value?.["experimental_approvals"];
        if (approvalsVal === "yes" || approvalsVal === "no") {
          writeWorkspaceApprovalsEnabled(approvalsVal === "yes" ? "on" : "off");
        }
      } catch (cause) {
        if (!cancelled) {
          setRegistry((prev) => (prev === null ? [] : prev));
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      }
    }
    void loadPreferences();
    return () => {
      cancelled = true;
    };
  }, []);
  const choose = async (id: string, choice: string) => {
    const isExperimental = syncExperimentalPreference(id, choice);
    const inHubRegistry =
      registry !== null && registry.some((entry) => entry.id === id);
    if (!field || (isExperimental && !inHubRegistry)) {
      if (isExperimental) {
        setSave({ id, state: "saved" });
      }
      return;
    }
    setSave({ id, state: "saving" });
    try {
      const receipt = await productClient().savePersonalSettings(
        await workspaceTenantId(),
        {
          command: "save_settings",
          idempotencyKey: crypto.randomUUID(),
          fields: {
            preferences: {
              value: { ...field.value, [id]: choice },
              baseVersion: field.version,
            },
          },
        },
      );
      setField(receipt.record.fields.preferences ?? field);
      void queryClient.invalidateQueries({ queryKey: keys.preferences });
      const conflicted = receipt.conflicts.length > 0;
      setSave({ id, state: conflicted ? "failed" : "saved" });
      if (conflicted) toast.error(wording.message.stepFailed);
    } catch (cause) {
      setSave({ id, state: "failed" });
      toast.error(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return {
    preferences: mergeExperimentalPreferences(registry).map((preference) => {
      const isExperimental = preference.id === "experimental_approvals";
      const state = save?.id === preference.id ? save.state : null;
      const choice = resolvePreferenceChoice(
        preference,
        field?.value,
        approvalsEnabled,
      );
      return {
        id: preference.id,
        label: preference.label,
        hint: preference.hint,
        save: state,
        disabled: (!field && !isExperimental) || state === "saving",
        ...(isOnOff(preference)
          ? { kind: "switch" as const, on: choice === "yes" }
          : { kind: "list" as const, options: preference.options, choice }),
      };
    }),
    onSwitch: (id, on) => void choose(id, on ? "yes" : "no"),
    onChoose: (id, choice) => void choose(id, choice),
    fault: error,
    focusPreference: focusPreference ?? null,
    focusSeq,
  };
}
