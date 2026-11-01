// What the person reads when the Docker install's sidecar-provisioner service cannot start an agent. It reaches
// them as the failed run's reason, or as the hub's startup error.
export const sidecarProvisionerWording = {
  unreachable:
    "Builder could not reach its sidecar-provisioner service, so the agent could not start. Start it with `docker compose up -d`, then try again.",
  unreachableAtStart:
    "Builder could not reach its sidecar-provisioner service, so it cannot start agents. Start it with `docker compose up -d`, then start Builder again.",
  unauthorized:
    "Builder's sidecar-provisioner service refused its token. Set the same SIDECAR_PROVISIONER_TOKEN for Builder and the service, then restart both.",
  invalidRequest:
    "Builder's sidecar-provisioner service could not read the agent's start request. Run Builder and the service at the same BUILDER_VERSION, then restart both.",
  bindingChanged:
    "Builder's sidecar-provisioner service now runs with another Docker setup than when Builder started. Restart Builder, then try again.",
};
