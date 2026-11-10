// When on, the hub moves a project's running agents onto the newest versions it ships once the
// project is quiet. When off, an agent keeps its version until the project is archived.
export const agentUpgrade = Object.freeze({ enabled: true });

// Read by the coordinator when a specialist it still waited on was stopped.
export const SPECIALIST_OUTDATED =
  "specialist_outdated: Builder was updated and this idle specialist was stopped; start it again to continue its work on the current version";
