/**
 * Reads every project value the plugins declare and saves one as the person, through the hub's
 * values route, which checks it against its declared type: a file must be one attached here.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { type } from "arktype";
import { toast } from "sonner";
import { ProductApiError } from "@corbits-builder/client";
import { FileValue, LinkValue } from "@corbits-builder/plugin";
import type { ProjectValues } from "@corbits-builder/schemas/artifact";
import { wording } from "../../config.ts";
import {
  readDeclaredProjectValues,
  saveProjectValue,
} from "../../api/artifacts.ts";
import { refusalBody } from "../../api/transport.ts";
import { keys } from "../../queries/keys.ts";
import { humanFault } from "./human-fault.ts";
import type {
  AttachedFile,
  ProjectValueRow,
  ProjectValuesViewProps,
  ValueEditor,
} from "./project-values.view.tsx";

const text = wording.projectValues;

export type ProjectValuesProps = {
  projectId: string;
  /** The files attached to the project, which a file value may name. */
  files: readonly AttachedFile[];
};

const EDITORS: readonly ValueEditor[] = ["text", "link", "file"];

// The editor a stored value fits and what it starts from, and how it reads in words.
function standing(value: unknown): Pick<ProjectValueRow, "shown" | "current"> {
  if (value === null) return { shown: null, current: null };
  if (typeof value === "string")
    return { shown: value, current: { editor: "text", draft: value } };
  if (LinkValue.allows(value))
    return {
      shown: value.link,
      current: { editor: "link", draft: value.link },
    };
  if (FileValue.allows(value))
    return {
      shown: value.name ?? value.file,
      current: { editor: "file", draft: value.file },
    };
  return { shown: JSON.stringify(value), current: null };
}

function rows(read: ProjectValues): ProjectValueRow[] {
  return Object.entries(read.declared ?? {}).map(
    ([name, { about, types }]) => ({
      name,
      about,
      editors: EDITORS.filter((editor) => types.includes(editor)),
      ...standing(read.values[name] ?? null),
    }),
  );
}

// What the person types, as the hub stores it for that kind of value.
const valueOf = (editor: ValueEditor, draft: string) => {
  if (editor === "link") return { link: draft.trim() };
  if (editor === "file") return { file: draft };
  return draft;
};

const Refused = type({
  issues: type({ path: "string", message: "string" }).array().atLeastLength(1),
});

// The hub names what is wrong with a value it refused, such as an address that is not http.
async function notSaved(cause: unknown) {
  if (!(cause instanceof ProductApiError))
    return humanFault(cause, text.notSaved);
  const refused = Refused(await refusalBody(cause));
  if (refused instanceof type.errors) return humanFault(cause, text.notSaved);
  const wrong = refused.issues.map(({ path, message }) => `${path} ${message}`);
  return `${text.notSaved} ${wrong.join("; ")}.`;
}

export function useProjectValues({
  projectId,
  files,
}: ProjectValuesProps): ProjectValuesViewProps {
  const queryClient = useQueryClient();
  const read = useQuery({
    queryKey: keys.projectValues.of(projectId),
    queryFn: ({ signal }) => readDeclaredProjectValues(projectId, signal),
    retry: false,
  });
  const [saving, setSaving] = useState<string | null>(null);
  const save = async (name: string, editor: ValueEditor, draft: string) => {
    setSaving(name);
    try {
      await saveProjectValue(projectId, name, valueOf(editor, draft));
      toast.success(text.saved(name));
      await queryClient.invalidateQueries({
        queryKey: keys.projectValues.of(projectId),
      });
    } catch (cause) {
      toast.error(await notSaved(cause));
    } finally {
      setSaving(null);
    }
  };
  let values: ProjectValuesViewProps["values"] = "loading";
  if (read.isError) values = "failed";
  if (read.data !== undefined) values = rows(read.data);
  return {
    values,
    files,
    saving,
    onSave: (name, editor, draft) => void save(name, editor, draft),
  };
}
