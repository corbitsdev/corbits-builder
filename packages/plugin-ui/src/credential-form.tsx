/**
 * A form that saves an API key a plugin declares to Interchange, through the person's own session:
 * the provider once in the workspace, and the key in the project or the workspace. What is typed
 * stays in this form's state; it is never put in an error, the address, browser storage or a log.
 */
import { useId, useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button, Input } from "@corbits/react-ui";
import type { HttpCredentialDeclaration } from "@corbits-builder/plugin";
import { ChoiceSegments } from "./choice-segments.tsx";
import { saveApiKey } from "./credentials.ts";
import form from "./form.module.css";
import styles from "./credential-form.module.css";

export type CredentialFormProps = {
  /** The credential's name as its plugin declares it. */
  name: string;
  declaration: HttpCredentialDeclaration;
  tenants: { project: string; workspace: string };
  onSaved: () => void;
};

type Scope = "project" | "workspace";

const text = {
  scope: "Save for",
  save: "Save",
  saving: "Saving…",
  show: "Show",
  hide: "Hide",
  refused: (code: string) => `Not saved (${code})`,
};

const SCOPES: readonly { id: Scope; label: string }[] = [
  { id: "project", label: "This project" },
  { id: "workspace", label: "Workspace" },
];

export function CredentialForm({
  name,
  declaration,
  tenants,
  onSaved,
}: CredentialFormProps) {
  const id = useId();
  const [key, setKey] = useState("");
  const [shown, setShown] = useState(false);
  const [scope, setScope] = useState<Scope>("project");
  const [saving, setSaving] = useState(false);
  const [fault, setFault] = useState<string>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setFault(undefined);
    try {
      await saveApiKey(
        { owner: tenants[scope], workspace: tenants.workspace },
        name,
        declaration,
        key,
      );
      onSaved();
    } catch (cause) {
      if (!(cause instanceof Error)) throw cause;
      setFault(text.refused(cause.message));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className={form.form}
      data-slot="credential-form"
      aria-busy={saving}
      noValidate
      onSubmit={(event) => void submit(event)}
    >
      <fieldset className={form.fields} disabled={saving}>
        {/* The screen card's title already shows these words. */}
        <label htmlFor={id} className="sr-only">
          {declaration.about}
        </label>
        <div className={styles.secret}>
          <Input
            id={id}
            type={shown ? "text" : "password"}
            value={key}
            // A key, not a sign-in: the browser must not fill a saved sign-in password here.
            autoComplete="new-password"
            spellCheck={false}
            onChange={(event) => setKey(event.target.value)}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={styles.reveal}
            aria-label={shown ? text.hide : text.show}
            aria-controls={id}
            onClick={() => setShown(!shown)}
          >
            {shown ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
          </Button>
        </div>
        <div className={styles.scope}>
          <label htmlFor={`${id}-scope`} className={styles.label}>
            {text.scope}
          </label>
          <ChoiceSegments
            id={`${id}-scope`}
            label={text.scope}
            options={SCOPES}
            choice={scope}
            onChoose={(option) => {
              const picked = SCOPES.find((entry) => entry.id === option);
              if (picked) setScope(picked.id);
            }}
          />
        </div>
      </fieldset>
      {fault === undefined ? null : (
        <p className={form.fault} role="alert">
          {fault}
        </p>
      )}
      <div className={form.actions}>
        {/* Saving keeps its colour and says so; the fieldset above is what stops input. */}
        <Button type="submit" disabled={key.trim() === ""}>
          {saving ? text.saving : text.save}
        </Button>
      </div>
    </form>
  );
}
