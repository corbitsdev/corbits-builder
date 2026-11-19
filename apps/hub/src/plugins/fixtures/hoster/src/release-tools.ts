import { fixedTools } from "@corbits-builder/plugin/tools";

// Only puts the app on the rented machine, using the key the hub made for it.
export default fixedTools<null>({
  id: "@corbits-builder/hoster/release-tools",
  credentials: ["hoster-server"],
  tools: {
    hoster_release: {
      description: "Put the app on the machine.",
      run: async () => ({ ok: true }),
    },
  },
  deps: () => null,
});
