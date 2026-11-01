import { type } from "arktype";
import type {
  DestroySidecarResult,
  EnsureSidecarResult,
  SidecarProvisioner,
} from "@intx/hub-sessions";
import { SidecarCapabilityDeclaration } from "@intx/types";
import { BINDING_HEADER } from "@corbits-builder/sidecar-provisioner/routes";
import { sidecarProvisionerWording } from "../config/sidecar-provisioner.ts";

/** Fetch failures where no connection opened, so the request cannot have taken effect. */
const NEVER_CONNECTED = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
]);

type Refusal = { readonly code: string; readonly message: string };

/** Answers the service gives before it acts on a call, so nothing took effect. */
const REFUSALS: ReadonlyMap<number, Refusal> = new Map([
  [
    400,
    {
      code: "sidecar_provisioner_invalid_request",
      message: sidecarProvisionerWording.invalidRequest,
    },
  ],
  [
    401,
    {
      code: "sidecar_provisioner_unauthorized",
      message: sidecarProvisionerWording.unauthorized,
    },
  ],
  [
    409,
    {
      code: "sidecar_provisioner_binding_changed",
      message: sidecarProvisionerWording.bindingChanged,
    },
  ],
]);

const Binding = type({
  bindingFingerprint: "string > 0",
  capabilities: SidecarCapabilityDeclaration.array(),
});

function neverConnected(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    NEVER_CONNECTED.has(error.code)
  );
}

class RefusedError extends Error {
  constructor(readonly refusal: Refusal) {
    super(refusal.message);
  }
}

type CreateRemoteSidecarProvisionerOpts = {
  /** The sidecar-provisioner service's origin. */
  readonly url: URL;
  /** The secret it expects as the bearer token. */
  readonly token: string;
};

/**
 * Forwards ensure and destroy to the sidecar-provisioner service, which starts each sidecar in its own container, so
 * the hub itself never holds the Docker socket. Interchange reads a provisioner's binding once, when the hub starts,
 * so this takes the service's Docker binding first and fails the start when the service cannot answer.
 */
export async function createRemoteSidecarProvisioner({
  url,
  token,
}: CreateRemoteSidecarProvisionerOpts): Promise<SidecarProvisioner> {
  const authorization = `Bearer ${token}`;

  async function readBinding(): Promise<typeof Binding.infer> {
    let response: Response;
    try {
      response = await fetch(new URL("/binding", url), {
        headers: { authorization },
      });
    } catch (error) {
      if (!neverConnected(error)) throw error;
      throw new Error(sidecarProvisionerWording.unreachableAtStart, {
        cause: error,
      });
    }
    if (response.status === 401)
      throw new Error(sidecarProvisionerWording.unauthorized);
    if (!response.ok)
      throw new Error(
        `Sidecar provisioner /binding failed (${String(response.status)}): ${await response.text()}`,
      );
    return Binding.assert(await response.json());
  }

  const binding = await readBinding();

  async function post(
    path: "/ensure" | "/destroy",
    { signal, ...body }: { readonly signal?: AbortSignal },
  ): Promise<unknown> {
    const response = await fetch(new URL(path, url), {
      method: "POST",
      headers: {
        authorization,
        [BINDING_HEADER]: binding.bindingFingerprint,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      ...(signal !== undefined && { signal }),
    });
    const refusal = REFUSALS.get(response.status);
    if (refusal !== undefined) throw new RefusedError(refusal);
    if (!response.ok)
      throw new Error(
        `Sidecar provisioner ${path} failed (${String(response.status)}): ${await response.text()}`,
      );
    return response.json();
  }

  return {
    id: "sidecar-provisioner",
    apiVersion: 2,
    bindingFingerprint: `sidecar-provisioner:v1:${binding.bindingFingerprint}`,
    capabilities: binding.capabilities,
    async ensure(request) {
      try {
        // The hub validates every provisioner result at runtime, so the service's answer passes through as sent.
        return (await post("/ensure", request)) as EnsureSidecarResult;
      } catch (error) {
        if (error instanceof RefusedError)
          return { kind: "rejected", ...error.refusal, retryable: false };
        if (!neverConnected(error)) throw error;
        return {
          kind: "rejected",
          code: "sidecar_provisioner_unreachable",
          message: sidecarProvisionerWording.unreachable,
          retryable: true,
        };
      }
    },
    async destroy(request) {
      try {
        return (await post("/destroy", request)) as DestroySidecarResult;
      } catch (error) {
        // Retryable, so cleanup resumes once the operator fixes the setup.
        if (error instanceof RefusedError)
          return { kind: "rejected", ...error.refusal, retryable: true };
        if (!neverConnected(error)) throw error;
        throw new Error(sidecarProvisionerWording.unreachable, {
          cause: error,
        });
      }
    },
  };
}
