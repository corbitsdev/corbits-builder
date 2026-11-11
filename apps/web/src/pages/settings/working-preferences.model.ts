/**
 * What the working preferences section does: reads the person's working preferences from the
 * hub's registry, where the hub keeps them and delivers them to every role they apply to, adds the
 * ones this browser keeps, and saves each change as it is made.
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
import {
  useQuestionsLayout,
  writeQuestionsLayout,
} from "../../questions-layout-setting.ts";
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

const { fallback, local } = wording.settings.preferences;

/** The hub's preferences, the ones it offers before they are read, and this browser's own. */
function listPreferences(hub: Registry): Registry {
  const fromFallback = fallback.filter(
    (item) => !hub.some((entry) => entry.id === item.id),
  );
  return [...hub, ...fromFallback, ...local];
}

const writeApprovals = (choice: string) =>
  writeWorkspaceApprovalsEnabled(choice === "yes" ? "on" : "off");

/** Writes a choice this browser keeps; the hub may keep the same one as well. */
const writeInBrowser: Readonly<Record<string, (choice: string) => void>> = {
  experimental_approvals: writeApprovals,
  questions_layout: (choice) =>
    writeQuestionsLayout(choice === "all" ? "all" : "steps"),
};

function useBrowserChoices(): Readonly<Record<string, string>> {
  const approvals = useWorkspaceApprovalsEnabled();
  const questionsLayout = useQuestionsLayout();
  return {
    experimental_approvals: approvals === "on" ? "yes" : "no",
    questions_layout: questionsLayout,
  };
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

  // The hub's record. Saves read the ref, so each builds on the version the one before it left.
  const [saved, setSaved] = useState<SavedPreferences | null>(null);
  const savedRef = useRef<SavedPreferences | null>(null);
  const keepSaved = (next: SavedPreferences) => {
    savedRef.current = next;
    setSaved(next);
  };

  // Picks shown at once while they save, and dropped if the save fails. A save reads the ref to
  // see whether a later pick of the same preference has replaced it.
  const [picked, setPicked] = useState<Readonly<Record<string, string>>>({});
  const pickedRef = useRef<Record<string, string>>({});
  const dropPick = (id: string, choice: string) => {
    if (pickedRef.current[id] !== choice) return;
    delete pickedRef.current[id];
    setPicked({ ...pickedRef.current });
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
        // The hub's approvals choice wins over the one this browser remembered.
        const approvals = loaded.value?.["experimental_approvals"];
        if (approvals !== undefined) writeApprovals(approvals);
      } catch (cause) {
        if (cancelled) return;
        setRegistry((current) => current ?? []);
        setFault(message(cause));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveToHub = async (id: string, choice: string) => {
    const base = savedRef.current;
    if (pickedRef.current[id] !== choice || !base) return;
    setSave({ id, state: "saving" });
    try {
      const receipt = await productClient().savePersonalSettings(
        await workspaceTenantId(),
        {
          command: "save_settings",
          idempotencyKey: crypto.randomUUID(),
          fields: {
            preferences: {
              value: { ...base.value, [id]: choice },
              baseVersion: base.version,
            },
          },
        },
      );
      keepSaved(receipt.record.fields.preferences ?? base);
      void queryClient.invalidateQueries({ queryKey: keys.preferences });
      if (receipt.conflicts.length > 0) {
        dropPick(id, choice);
        setSave({ id, state: "failed" });
        toast.error(wording.message.stepFailed);
      } else {
        setSave({ id, state: "saved" });
      }
    } catch (cause) {
      dropPick(id, choice);
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
    pickedRef.current[id] = choice;
    setPicked({ ...pickedRef.current });
    queue.current = queue.current.then(() => saveToHub(id, choice));
  };

  return {
    preferences: listPreferences(registry ?? []).map((preference) => ({
      id: preference.id,
      label: preference.label,
      group: preference.group,
      hint: preference.hint ?? "",
      browserOnly: local.some((entry) => entry.id === preference.id),
      options: preference.options,
      choice:
        inBrowser[preference.id] ??
        picked[preference.id] ??
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
