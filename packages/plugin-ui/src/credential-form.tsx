/**
 * A form that saves an API key a plugin declares to Interchange, through the person's own session:
 * the provider once in the workspace, and the key in the project or the workspace. What is typed
 * stays in this form's state; it is never put in an error, the address, browser storage or a log.
 */
import { useId, useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button, Input } from "@corbits/react-ui";
import {
  credentialProvider,
  type CredentialDeclaration,
} from "@corbits-builder/plugin";
import {
  CredentialResponse,
  ErrorResponse,
  ProviderResponse,
  paginatedSchema,
} from "@intx/types";
import { ChoiceSegments } from "./choice-segments.tsx";
import styles from "./credential-form.module.css";

export type CredentialFormProps = {
  /** The credential's name as its plugin declares it. */
  name: string;
  declaration: CredentialDeclaration;
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

const Providers = paginatedSchema(ProviderResponse);
const Credentials = paginatedSchema(CredentialResponse);

async function refusal(response: Response): Promise<Error> {
  const code = String(response.status);
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    // A proxy's error page is not JSON; its status is all there is to show.
    if (!(error instanceof SyntaxError)) throw error;
    return new Error(code);
  }
  return new Error(ErrorResponse.allows(body) ? body.error.code : code);
}

async function send(
  path: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  body: object | undefined,
): Promise<Response> {
  const init: RequestInit = { method, credentials: "same-origin" };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return fetch(`/api/tenants/${path}`, init);
}

async function json(
  path: string,
  method: "GET" | "POST" | "PATCH",
  body: object | undefined,
): Promise<unknown> {
  const response = await send(path, method, body);
  if (!response.ok) throw await refusal(response);
  return response.json();
}

function secretOf(sends: CredentialDeclaration["sends"], key: string): string {
  if (sends === "bearer") return key;
  const material: { header: string; prefix?: string; value: string } = {
    header: sends.header,
    value: key,
  };
  if (sends.prefix !== undefined) material.prefix = sends.prefix;
  return JSON.stringify(material);
}

const credentialPath = (tenant: string, id: string) =>
  `${encodeURIComponent(tenant)}/credentials/${encodeURIComponent(id)}`;

/** Every credential the tenant holds itself, read page by page; never a secret. */
export async function heldCredentials(tenant: string) {
  const path = `${encodeURIComponent(tenant)}/credentials`;
  let page = Credentials.assert(await json(path, "GET", undefined));
  const held = page.data;
  while (page.nextCursor !== null) {
    page = Credentials.assert(
      await json(
        `${path}?cursor=${encodeURIComponent(page.nextCursor)}`,
        "GET",
        undefined,
      ),
    );
    held.push(...page.data);
  }
  return held;
}

export async function revokeCredential(
  tenant: string,
  id: string,
): Promise<void> {
  const response = await send(credentialPath(tenant, id), "DELETE", undefined);
  if (!response.ok) throw await refusal(response);
}

type Sending = Pick<CredentialDeclaration, "origin" | "sends">;

/** The workspace's provider a credential is saved under, created or brought in line with how its
 * plugin sends it; its id. */
async function syncProvider(
  name: string,
  { origin, sends }: Sending,
  workspaceTenant: string,
): Promise<string> {
  // The provider and the credential share one name.
  const provider = credentialProvider(name);
  const workspace = encodeURIComponent(workspaceTenant);
  const plugin = sends === "bearer" ? "http" : "http-header";
  // The inherited listing is the unpaged one; a provider named here in the workspace shadows any above it.
  const listed = Providers.assert(
    await json(`${workspace}/providers`, "GET", undefined),
  );
  const existing = listed.data.find(
    (row) => row.name === provider && row.tenantId === workspaceTenant,
  );
  if (!existing)
    return ProviderResponse.assert(
      await json(`${workspace}/providers`, "POST", {
        name: provider,
        plugin,
        apiBaseUrl: origin,
      }),
    ).id;
  if (existing.plugin !== plugin || existing.apiBaseUrl !== origin)
    await json(
      `${workspace}/providers/${encodeURIComponent(existing.id)}`,
      "PATCH",
      { plugin, apiBaseUrl: origin },
    );
  return existing.id;
}

async function rotate(
  owner: string,
  id: string,
  sends: CredentialDeclaration["sends"],
  key: string,
): Promise<void> {
  await json(credentialPath(owner, id), "PATCH", {
    secret: secretOf(sends, key),
    status: "active",
  });
}

/** Puts a new key in a credential its owner tenant holds, sent the way its plugin declares. */
export async function replaceCredential(
  tenants: { owner: string; workspace: string },
  id: string,
  name: string,
  sending: Sending,
  key: string,
): Promise<void> {
  await syncProvider(name, sending, tenants.workspace);
  await rotate(tenants.owner, id, sending.sends, key);
}

async function saveCredential(
  { name, declaration, tenants }: Omit<CredentialFormProps, "onSaved">,
  scope: Scope,
  key: string,
): Promise<void> {
  const providerId = await syncProvider(name, declaration, tenants.workspace);
  const provider = credentialProvider(name);
  const owner = tenants[scope];
  const credentials = `${encodeURIComponent(owner)}/credentials`;
  const resolved = await send(
    `${credentials}/resolve/${encodeURIComponent(provider)}`,
    "GET",
    undefined,
  );
  if (resolved.ok) {
    const held = CredentialResponse.assert(await resolved.json());
    // Resolution walks up the tenants; only a credential this tenant holds is replaced.
    if (held.tenantId === owner) {
      await rotate(owner, held.id, declaration.sends, key);
      return;
    }
  } else if (resolved.status !== 404) throw await refusal(resolved);
  await json(credentials, "POST", {
    providerId,
    name: provider,
    type: "api_key",
    secret: secretOf(declaration.sends, key),
  });
}

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
      await saveCredential({ name, declaration, tenants }, scope, key);
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
      className={styles.form}
      data-slot="credential-form"
      aria-busy={saving}
      noValidate
      onSubmit={(event) => void submit(event)}
    >
      <fieldset className={styles.fields} disabled={saving}>
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
        <p className={styles.fault} role="alert">
          {fault}
        </p>
      )}
      <div className={styles.actions}>
        {/* Saving keeps its colour and says so; the fieldset above is what stops input. */}
        <Button type="submit" disabled={key.trim() === ""}>
          {saving ? text.saving : text.save}
        </Button>
      </div>
    </form>
  );
}
