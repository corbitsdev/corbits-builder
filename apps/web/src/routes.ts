/** The open project lives in the path, so a reload keeps it and Back returns to the list. */
export function projectInUrl(): string | null {
  const [, projectId] =
    /^\/project\/(.+)$/.exec(window.location.pathname) ?? [];
  return projectId ? decodeURIComponent(projectId) : null;
}

/** An invitation link: `/invite/<id>`. */
export function inviteInUrl(): string | null {
  const [, invitationId] =
    /^\/invite\/(.+)$/.exec(window.location.pathname) ?? [];
  return invitationId ? decodeURIComponent(invitationId) : null;
}

/** pushState fires no event, so the history subscribers are told directly. */
export function navigate(path: string): void {
  if (window.location.pathname === path) return;
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function writeProjectUrl(projectId: string | null): void {
  const path = projectId ? `/project/${encodeURIComponent(projectId)}` : "/";
  if (window.location.pathname === path) return;
  window.history.pushState(
    null,
    "",
    projectId ? path : path + window.location.search,
  );
}

export function subscribeToHistory(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

/** Links from before path routing (`/#/project/<id>`) still open what they named. */
export function redirectHashLink(): void {
  const { hash, search } = window.location;
  if (hash.startsWith("#/"))
    window.history.replaceState(null, "", hash.slice(1) + search);
}
