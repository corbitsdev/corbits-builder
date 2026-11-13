/**
 * The plugins' screen files and roles, compiled in when the interface is built, so a new plugin
 * folder needs a rebuild. Only the app entry imports this module: import.meta.glob needs Vite.
 */
import { installRoles } from "./roles.ts";
import { installScreens, type ScreenFiles } from "./screens.ts";

const manifests = import.meta.glob<ScreenFiles["manifests"][string]>(
  "@plugins/*/package.json",
  { eager: true, import: "default" },
);

// Only these files of a plugin are bundled: the rest of its folder is the hub's, which may not
// run in a browser.
const definitions = import.meta.glob("@plugins/*/src/*/definition.ts", {
  eager: true,
  import: "default",
});

installRoles({ manifests, definitions });
installScreens({
  manifests,
  definitions,
  data: import.meta.glob("@plugins/*/src/*/data.json", {
    eager: true,
    import: "default",
  }),
  views: import.meta.glob<ScreenFiles["views"][string]>(
    "@plugins/*/src/*/view.tsx",
    { eager: true, import: "default" },
  ),
});
