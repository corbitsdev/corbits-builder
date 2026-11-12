/**
 * The plugins' screen files, compiled in when the interface is built, so a new plugin folder needs
 * a rebuild. Only the app entry imports this module: import.meta.glob needs Vite.
 */
import { installScreens, type ScreenFiles } from "./screens.ts";

// Only these files of a plugin are bundled: the rest of its folder is the hub's, which may not
// run in a browser.
installScreens({
  manifests: import.meta.glob<ScreenFiles["manifests"][string]>(
    "../../../../../plugins/*/package.json",
    { eager: true, import: "default" },
  ),
  modules: import.meta.glob(
    [
      "../../../../../plugins/*/src/*/screen.ts",
      "../../../../../plugins/*/data/*.json",
    ],
    { eager: true, import: "default" },
  ),
  views: import.meta.glob<ScreenFiles["views"][string]>(
    "../../../../../plugins/*/src/*/view.tsx",
    { eager: true, import: "default" },
  ),
});
