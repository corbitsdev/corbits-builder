/**
 * What the working preferences section does: reads the person's working preferences from the
 * hub's registry, where the hub keeps them and delivers them to every role they apply to, and saves
 * each change as it is made.
 */
import { wording } from "../../config.ts";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { preferencesQuery } from "../../queries/preferences.ts";
import { productClient } from "../../api/transport.ts";
import { workspaceTenantId } from "../../api/auth.ts";
import type { WorkingPreferencesViewProps } from "./working-preferences.view.tsx";

export type WorkingPreferencesProps = {
  focusPreference?: string;
  focusSeq?: number;
};

type PickedChoice = { choice: string };

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function useWorkingPreferences({
  focusPreference,
  focusSeq = 0,
}: WorkingPreferencesProps): Omit<WorkingPreferencesViewProps, "reviewers"> {
  const queryClient = useQueryClient();
  const preferences = useQuery(preferencesQuery);
  const registry = preferences.data?.registry;
  const saved = preferences.data?.saved;
  const [save, setSave] = useState<{
    id: string;
    state: "saving" | "saved" | "failed";
  } | null>(null);
  const [picked, setPicked] = useState<Readonly<Record<string, PickedChoice>>>(
    {},
  );
  const pickedRef = useRef<Record<string, PickedChoice>>({});

  // Compare picks by identity: choosing A, then B, then A is still three separate picks.
  const dropPick = (id: string, pick: PickedChoice) => {
    if (pickedRef.current[id] !== pick) return;
    delete pickedRef.current[id];
    setPicked({ ...pickedRef.current });
  };

  const queue = useRef<Promise<void>>(Promise.resolve());

  const saveToHub = async (id: string, pick: PickedChoice) => {
    const current = queryClient.getQueryData(preferencesQuery.queryKey);
    const base = current?.saved;
    if (pickedRef.current[id] !== pick || !base || !current) return;
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
      queryClient.setQueryData(preferencesQuery.queryKey, {
        registry: current.registry,
        saved: receipt.record.fields.preferences ?? base,
      });
      dropPick(id, pick);
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
    if (!saved || !registry?.some((entry) => entry.id === id)) return;
    const pick = { choice };
    pickedRef.current[id] = pick;
    setPicked({ ...pickedRef.current });
    const before = queue.current;
    async function saveAfterEarlierSaves() {
      await before;
      await saveToHub(id, pick);
    }
    queue.current = saveAfterEarlierSaves();
  };

  return {
    preferences: (registry ?? []).map((preference) => ({
      id: preference.id,
      label: preference.label,
      group: preference.group,
      hint: preference.hint,
      options: preference.options,
      choice:
        picked[preference.id]?.choice ??
        saved?.value?.[preference.id] ??
        preference.default,
      ends: preference.ends ?? null,
      save: save?.id === preference.id ? save.state : null,
      disabled: !saved,
    })),
    onChoose: choose,
    fault: preferences.error ? message(preferences.error) : null,
    focusPreference: focusPreference ?? null,
    focusSeq,
  };
}
