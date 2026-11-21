import { expect, test } from "bun:test";
import type { SidecarStoppedOptions } from "@intx/hub-sessions";
import type { SidecarView } from "@intx/types";
import { createDockerSidecarProvisioner } from "./docker.ts";

function sidecar(sidecarId: string): SidecarView {
  return {
    sidecarId,
    retired: false,
    adapterManifestDigest: "digest",
    deployments: [],
    probes: [],
  };
}

function container(State: string, sidecarId: string) {
  return {
    Id: `container-${sidecarId}`,
    State,
    Labels: {
      "corbits-builder.hub": "hub",
      "corbits-builder.allocation": `allocation-${sidecarId}`,
      "corbits-builder.generation": "1",
      "corbits-builder.sidecar": sidecarId,
    },
  };
}

test("every sidecar whose container vanished or exited is reported stopped before any placement, even when one report fails", async () => {
  const provisioner = createDockerSidecarProvisioner({
    engine: {
      host: "unix:///fake.sock",
      async request(method, path) {
        if (method === "GET" && path.startsWith("/containers/json"))
          return [
            container("running", "present"),
            container("exited", "exited"),
          ];
        throw new Error(`Unexpected Docker call ${method} ${path}`);
      },
    },
    hubId: "hub",
    daemonId: "daemon",
    image: "image",
    adapterManifest: [],
    sshAllowPrivateAddresses: false,
    log: () => undefined,
  });
  const reported: [string, SidecarStoppedOptions | undefined][] = [];
  provisioner.attach?.({
    listSidecars: async () => [
      sidecar("present"),
      sidecar("exited"),
      sidecar("vanished"),
    ],
    retireIfIdle: () => {
      throw new Error("retireIfIdle is not expected");
    },
    async sidecarStopped(sidecarId, options) {
      reported.push([sidecarId, options]);
      if (sidecarId === "exited") throw new Error("transient");
      return { kind: "retired" };
    },
  });

  // An aborted ensure stops right after waiting for the catch-up, so the report must already be in.
  await expect(
    provisioner.ensure({
      signal: AbortSignal.abort(),
      allocationId: "allocation-2",
      generation: 1,
      tenantId: "tenant",
      anchorRunId: "run",
      sidecarId: "new",
      token: "token",
      hubWebSocketUrl: "ws://127.0.0.1:1/",
    }),
  ).rejects.toThrow();
  expect(reported).toEqual([
    ["exited", { endReconnectWindow: true }],
    ["vanished", { endReconnectWindow: true }],
  ]);
});
