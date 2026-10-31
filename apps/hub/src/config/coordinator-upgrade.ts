// When on, every project's coordinator moves to the newest coordinator the hub ships. Once a project
// is idle (its coordinator is waiting for the person, nothing awaits an approval and no specialist is
// working), the hub stops the old coordinator, keeps its history, and starts a new one on the same
// project with its documents, approvals and app; the person sees the project resume. When off, a
// coordinator keeps the version it started with until the project is archived.
export const coordinatorUpgrade = Object.freeze({ enabled: true });
