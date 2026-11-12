/**
 * The project values the plugins declare, each with what it holds, what it is now, and an editor
 * fit for its type: a text box, an address box, or a pick among the files attached to the project.
 * A value that may be more than one kind says which it is with a select.
 */
import { useState } from "react";
import { Button, Input, Section, Textarea } from "@corbits/react-ui";
import { wording } from "../../config.ts";
import { Fault, Field, InlineNote, QuietSelect } from "../../components.tsx";

const text = wording.projectValues;

/** A kind of value the person can write here. */
export type ValueEditor = "text" | "link" | "file";

/** A file attached to the project, which a file value names. */
export type AttachedFile = { artifactId: string; name: string };

/** One declared value, as the project holds it. */
export type ProjectValueRow = {
  name: string;
  about: string;
  /** The editors its types take, in its declared order; none for a value shown as stored. */
  editors: readonly ValueEditor[];
  /** What it is now, in words; null when the project has none. */
  shown: string | null;
  /** The editor it now fits and what that editor starts from: the text, the address or the file's id. */
  current: { editor: ValueEditor; draft: string } | null;
};

export type ProjectValuesViewProps = {
  values: "loading" | "failed" | readonly ProjectValueRow[];
  files: readonly AttachedFile[];
  /** The value being saved, by name. */
  saving: string | null;
  /** Saves a value from its editor's draft. */
  onSave: (name: string, editor: ValueEditor, draft: string) => void;
};

export function ProjectValuesView({
  values,
  files,
  saving,
  onSave,
}: ProjectValuesViewProps) {
  return (
    <Section title={text.tab} description={text.title}>
      {values === "loading" ? (
        <InlineNote role="status">{text.loading}</InlineNote>
      ) : null}
      {values === "failed" ? <Fault>{text.failed}</Fault> : null}
      {typeof values === "string"
        ? null
        : values.map((row) => (
            <ValueRowView
              // A save reads the value back, which starts its editor over from what was stored.
              key={`${row.name}:${row.shown ?? ""}`}
              row={row}
              files={files}
              saving={saving === row.name}
              onSave={(editor, draft) => onSave(row.name, editor, draft)}
            />
          ))}
    </Section>
  );
}

function ValueRowView({
  row,
  files,
  saving,
  onSave,
}: {
  row: ProjectValueRow;
  files: readonly AttachedFile[];
  saving: boolean;
  onSave: (editor: ValueEditor, draft: string) => void;
}) {
  const [editor, setEditor] = useState<ValueEditor | undefined>(
    row.current?.editor ?? row.editors[0],
  );
  const [draft, setDraft] = useState(row.current?.draft ?? "");
  const id = `project-value-${row.name}`;
  const choose = (next: ValueEditor) => {
    setEditor(next);
    setDraft(row.current?.editor === next ? row.current.draft : "");
  };
  return (
    <Section as="h3" title={row.name} description={row.about}>
      <p>{row.shown ?? text.notSet}</p>
      {editor === undefined ? (
        <InlineNote>{text.readOnly}</InlineNote>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSave(editor, draft);
          }}
        >
          {row.editors.length > 1 ? (
            <Field>
              <QuietSelect
                aria-label={`${row.name}: ${text.kind}`}
                value={editor}
                disabled={saving}
                onChange={(event) => {
                  const next = row.editors.find(
                    (each) => each === event.target.value,
                  );
                  if (next !== undefined) choose(next);
                }}
              >
                {row.editors.map((each) => (
                  <option key={each} value={each}>
                    {text[each]}
                  </option>
                ))}
              </QuietSelect>
            </Field>
          ) : null}
          <Field>
            <label htmlFor={id}>{text[editor]}</label>
            <EditorField
              id={id}
              editor={editor}
              draft={draft}
              files={files}
              disabled={saving}
              onDraft={setDraft}
            />
          </Field>
          <Button
            type="submit"
            size="sm"
            disabled={saving || draft.trim() === ""}
          >
            {text.save}
          </Button>
        </form>
      )}
    </Section>
  );
}

function EditorField({
  id,
  editor,
  draft,
  files,
  disabled,
  onDraft,
}: {
  id: string;
  editor: ValueEditor;
  draft: string;
  files: readonly AttachedFile[];
  disabled: boolean;
  onDraft: (draft: string) => void;
}) {
  if (editor === "text")
    return (
      <Textarea
        id={id}
        value={draft}
        disabled={disabled}
        autoResize
        onChange={(event) => onDraft(event.target.value)}
      />
    );
  if (editor === "link")
    return (
      <Input
        id={id}
        type="url"
        inputMode="url"
        placeholder={text.linkPlaceholder}
        value={draft}
        disabled={disabled}
        onChange={(event) => onDraft(event.target.value)}
      />
    );
  if (files.length === 0) return <InlineNote>{text.noFiles}</InlineNote>;
  return (
    <QuietSelect
      id={id}
      value={draft}
      disabled={disabled}
      onChange={(event) => onDraft(event.target.value)}
    >
      <option value="">{text.chooseFile}</option>
      {files.map((file) => (
        <option key={file.artifactId} value={file.artifactId}>
          {file.name}
        </option>
      ))}
    </QuietSelect>
  );
}
