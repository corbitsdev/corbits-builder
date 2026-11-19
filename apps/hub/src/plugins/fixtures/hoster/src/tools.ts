import { fixedTools } from "@corbits-builder/plugin/tools";

// Rents and gives back the machine through the person's Hoster sign-in. The hub makes the
// machine's key, so these tools never bind it.
export default fixedTools<null>({
  id: "@corbits-builder/hoster/tools",
  credentials: ["hoster"],
  tools: {
    hoster_machine: {
      description: "Rent the machine.",
      run: async () => ({ ok: true }),
    },
  },
  deps: () => null,
});
