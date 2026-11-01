import { expect, test } from "bun:test";
import type { SidecarProvisioner } from "@intx/hub-sessions";
import {
  BINDING_HEADER,
  createProvisionerRoutes,
} from "@corbits-builder/sidecar-provisioner/routes";
import { sidecarProvisionerWording } from "../config/sidecar-provisioner.ts";
import { createRemoteSidecarProvisioner } from "./remote.ts";

const ensureRequest = {
  allocationId: "allocation-1",
  generation: 1,
  tenantId: "tenant-1",
  anchorRunId: "run-1",
  sidecarId: "sidecar-1",
  token: "sidecar-token",
  hubWebSocketUrl: "ws://hub:8000/api/sidecars/ws",
};
const destroyRequest = {
  allocationId: "allocation-1",
  generation: 1,
  sidecarId: "sidecar-1",
};

const secret = "a".repeat(32);
const capabilities = [
  { capability: "runtime:posix", state: "available" },
] as const;

function serve(token: string) {
  const calls: unknown[] = [];
  let bindingFingerprint = "docker:v1:daemon:hub";
  const provisioner: SidecarProvisioner = {
    id: "service",
    apiVersion: 2,
    get bindingFingerprint() {
      return bindingFingerprint;
    },
    capabilities,
    async ensure({ signal: _signal, ...request }) {
      calls.push(request);
      return { kind: "accepted", externalRef: "container-1" };
    },
    async destroy({ signal: _signal, ...request }) {
      calls.push(request);
      return { kind: "destroyed", cleanup: "confirmed" };
    },
  };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    routes: createProvisionerRoutes({ provisioner, token }),
  });
  return {
    calls,
    server,
    rebind(fingerprint: string) {
      bindingFingerprint = fingerprint;
    },
  };
}

test("the hub's provisioner takes the service's binding and forwards ensure and destroy with its secret", async () => {
  const { calls, server, rebind } = serve(secret);
  try {
    const remote = await createRemoteSidecarProvisioner({
      url: server.url,
      token: secret,
    });
    expect(remote.bindingFingerprint).toBe(
      "sidecar-provisioner:v1:docker:v1:daemon:hub",
    );
    expect(remote.capabilities).toEqual(capabilities);
    expect(await remote.ensure(ensureRequest)).toEqual({
      kind: "accepted",
      externalRef: "container-1",
    });
    expect(await remote.destroy(destroyRequest)).toEqual({
      kind: "destroyed",
      cleanup: "confirmed",
    });
    expect(calls).toEqual([ensureRequest, destroyRequest]);

    rebind("docker:v1:other-daemon:hub");
    expect(await remote.ensure(ensureRequest)).toEqual({
      kind: "rejected",
      code: "sidecar_provisioner_binding_changed",
      message: sidecarProvisionerWording.bindingChanged,
      retryable: false,
    });
    expect(calls).toHaveLength(2);

    await expect(
      createRemoteSidecarProvisioner({
        url: server.url,
        token: "b".repeat(32),
      }),
    ).rejects.toThrow(sidecarProvisionerWording.unauthorized);
  } finally {
    await server.stop(true);
  }
});

test("the service answers a body that is not JSON with 400", async () => {
  const { server } = serve(secret);
  try {
    const response = await fetch(new URL("/ensure", server.url), {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        [BINDING_HEADER]: "docker:v1:daemon:hub",
      },
      body: "{",
    });
    expect(response.status).toBe(400);
  } finally {
    await server.stop(true);
  }
});

test("an unreachable service fails the hub's start, then rejects placement with the person's reason and never confirms destruction", async () => {
  const { server } = serve(secret);
  const url = server.url;
  const remote = await createRemoteSidecarProvisioner({ url, token: secret });
  await server.stop(true);
  await expect(
    createRemoteSidecarProvisioner({ url, token: secret }),
  ).rejects.toThrow(sidecarProvisionerWording.unreachableAtStart);
  expect(await remote.ensure(ensureRequest)).toEqual({
    kind: "rejected",
    code: "sidecar_provisioner_unreachable",
    message: sidecarProvisionerWording.unreachable,
    retryable: true,
  });
  await expect(remote.destroy(destroyRequest)).rejects.toThrow(
    sidecarProvisionerWording.unreachable,
  );
});
