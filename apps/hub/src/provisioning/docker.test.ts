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
  const dockerCalls: string[] = [];
  const provisioner = createDockerSidecarProvisioner({
    engine: {
      host: "unix:///fake.sock",
      async request(method, path) {
        dockerCalls.push(`${method} ${path}`);
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
  const sidecars = Promise.withResolvers<SidecarView[]>();
  provisioner.attach?.({
    listSidecars: () => sidecars.promise,
    retireIfIdle: () => {
      throw new Error("retireIfIdle is not expected");
    },
    async sidecarStopped(sidecarId, options) {
      reported.push([sidecarId, options]);
      if (sidecarId === "exited") throw new Error("transient");
      return { kind: "retired" };
    },
  });

  const placement = new AbortController();
  const ensured = provisioner.ensure({
    signal: placement.signal,
    allocationId: "allocation-2",
    generation: 1,
    tenantId: "tenant",
    anchorRunId: "run",
    sidecarId: "new",
    token: "token",
    hubWebSocketUrl: "ws://127.0.0.1:1/",
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(dockerCalls).toEqual([]);

  // An aborted ensure stops right after waiting for the catch-up, so the report must already be in.
  placement.abort();
  sidecars.resolve([
    sidecar("present"),
    sidecar("exited"),
    sidecar("vanished"),
  ]);
  await expect(ensured).rejects.toThrow();
  expect(reported).toEqual([
    ["exited", { endReconnectWindow: true }],
    ["vanished", { endReconnectWindow: true }],
  ]);
});
