/**
 * What the working preferences section does: reads the person's working preferences from the
 * hub's registry, where the hub keeps them and delivers them to every role they apply to, and saves
 * each change as it is made.
 */
import { wording } from "../../config.ts";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { keys } from "../../queries/keys.ts";
import {
  useWorkspaceApprovalsEnabled,
  writeWorkspaceApprovalsEnabled,
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

type Registry = PreferenceRegistry["preferences"];

type SavedPreferences = { value: Preferences | null; version: number };
type PickedChoice = { choice: string };

const { fallback } = wording.settings.preferences;

/** The hub's preferences, and the ones it offers before they are read or when they cannot be. */
function listPreferences(hub: Registry | null): Registry {
  if (!hub) return fallback;
  const fromFallback = fallback.filter(
    (item) => !hub.some((entry) => entry.id === item.id),
  );
  return [...hub, ...fromFallback];
}

const writeApprovals = (choice: string) =>
  writeWorkspaceApprovalsEnabled(choice === "yes" ? "on" : "off");

/** Writes a choice this browser keeps; the hub may keep the same one as well. */
const writeInBrowser: Readonly<Record<string, (choice: string) => void>> = {
  experimental_approvals: writeApprovals,
};

function useBrowserChoices(): Readonly<Record<string, string>> {
  const approvals = useWorkspaceApprovalsEnabled();
  return { experimental_approvals: approvals === "on" ? "yes" : "no" };
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function useWorkingPreferences({
  focusPreference,
  focusSeq = 0,
}: WorkingPreferencesProps): Omit<WorkingPreferencesViewProps, "reviewers"> {
  const queryClient = useQueryClient();
  const inBrowser = useBrowserChoices();
  const [registry, setRegistry] = useState<Registry | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  const [save, setSave] = useState<{
    id: string;
    state: "saving" | "saved" | "failed";
  } | null>(null);
  const [picked, setPicked] = useState<Readonly<Record<string, PickedChoice>>>(
    {},
  );
  const pickedRef = useRef<Record<string, PickedChoice>>({});

  // The hub's record. Saves read the ref, so each builds on the version the one before it left.
  const [saved, setSaved] = useState<SavedPreferences | null>(null);
  const savedRef = useRef<SavedPreferences | null>(null);
  const keepSaved = (next: SavedPreferences) => {
    savedRef.current = next;
    setSaved(next);
    const approvals = next.value?.["experimental_approvals"];
    if (
      approvals !== undefined &&
      pickedRef.current["experimental_approvals"] === undefined
    )
      writeApprovals(approvals);
  };

  // Compare picks by identity: choosing A, then B, then A is still three separate picks.
  const dropPick = (id: string, pick: PickedChoice) => {
    if (pickedRef.current[id] !== pick) return;
    delete pickedRef.current[id];
    setPicked({ ...pickedRef.current });
    const settled =
      savedRef.current?.value?.[id] ??
      registry?.find((entry) => entry.id === id)?.default;
    if (settled !== undefined) writeInBrowser[id]?.(settled);
  };

  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const tenantId = await workspaceTenantId();
        const [read, record] = await Promise.all([
          productClient().preferenceRegistry(tenantId),
          productClient().personalSettings(tenantId),
        ]);
        if (cancelled) return;
        setRegistry(read.preferences);
        const loaded = record.fields.preferences ?? { value: null, version: 0 };
        keepSaved(loaded);
      } catch (cause) {
        if (cancelled) return;
        setFault(message(cause));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveToHub = async (id: string, pick: PickedChoice) => {
    const base = savedRef.current;
    if (pickedRef.current[id] !== pick || !base) return;
    setSave({ id, state: "saving" });
    try {
      const receipt = await productClient().savePersonalSettings(
        await workspaceTenantId(),
        {
          command: "save_settings",
          idempotencyKey: crypto.randomUUID(),
          fields: {
            preferences: {
              value: { ...base.value, [id]: pick.choice },
              baseVersion: base.version,
            },
          },
        },
      );
      keepSaved(receipt.record.fields.preferences ?? base);
      dropPick(id, pick);
      void queryClient.invalidateQueries({ queryKey: keys.preferences });
      if (receipt.conflicts.length > 0) {
        setSave({ id, state: "failed" });
        toast.error(wording.message.stepFailed);
      } else {
        setSave({ id, state: "saved" });
      }
    } catch (cause) {
      dropPick(id, pick);
      setSave({ id, state: "failed" });
      toast.error(message(cause));
    }
  };

  const choose = (id: string, choice: string) => {
    const write = writeInBrowser[id];
    write?.(choice);
    const inHub = registry?.some((entry) => entry.id === id) ?? false;
    if (!inHub || !savedRef.current) {
      if (write) setSave({ id, state: "saved" });
      return;
    }
    const pick = { choice };
    pickedRef.current[id] = pick;
    setPicked({ ...pickedRef.current });
    const before = queue.current;
    queue.current = (async () => {
      await before;
      await saveToHub(id, pick);
    })();
  };

  return {
    preferences: listPreferences(registry).map((preference) => ({
      id: preference.id,
      label: preference.label,
      group: preference.group,
      hint: preference.hint,
      options: preference.options,
      choice:
        inBrowser[preference.id] ??
        picked[preference.id]?.choice ??
        saved?.value?.[preference.id] ??
        preference.default,
      ends: preference.ends ?? null,
      save: save?.id === preference.id ? save.state : null,
      disabled: !saved && !(preference.id in inBrowser),
    })),
    onChoose: choose,
    fault,
    focusPreference: focusPreference ?? null,
    focusSeq,
  };
}
