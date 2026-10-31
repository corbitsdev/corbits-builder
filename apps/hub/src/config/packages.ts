// Hosts a build sandbox reaches when the person turned its internet off: bun resolves metadata and
// tarballs from the npm registry. With the internet on it may reach any public host, and the package
// approval steers which packages the app takes on; it does not contain what a script can download.
export const CODER_REGISTRY_HOSTS = ["registry.npmjs.org"] as const;
export const DEFAULT_STACK =
  "the coder's starter, a Bun workspace with client/ (Vite, React, React Router, TanStack Query, Tailwind CSS v4 and @corbits/react-ui), server/ (Hono on Bun, static JSON data or PGlite with Drizzle when the app stores what people enter) and packages/shared (zod schemas both sides use).";
